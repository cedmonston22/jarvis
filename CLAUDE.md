# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Meta-Ray-Bans / Apple-Vision-Pro-style web app. The webcam fills the screen, the user is shown centered with their background blurred, and floating "app" windows orbit around them. All interaction is gesture (hand tracking via MediaPipe) + voice (Web Speech API). Real Google/Spotify API integrations and Supabase auth are deliberately deferred — v1 ships with mock apps so gesture UX can be validated first.

The full approved architecture and milestone plan lives at `C:\Users\cgedm\.claude\plans\tender-sprouting-cerf.md`. Read it before making non-trivial changes.

## Commands

```bash
npm install        # also runs postinstall: copies MediaPipe WASM + downloads .tflite/.task models into public/mediapipe/
npm run dev        # Vite dev server on :5173 (HTTPS not required — getUserMedia works on localhost)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint . (flat config in eslint.config.js)
npm run test       # vitest run
npm run test:watch # vitest in watch mode
npm run build      # tsc -b && vite build
```

Run a single test file: `npx vitest run src/gestures/stateMachine.test.ts`.

After any code change, run `npm run typecheck && npm run lint && npm run test`. Fix all errors — do not leave red.

## Architecture hard rules

Two disjoint data paths that only meet through a gesture event bus:

```
<video> (hidden)
  │ requestVideoFrameCallback loop (src/lib/frameLoop.ts)
  ├─ ImageSegmenter  (every 2nd frame, ~15 fps)  → maskRef
  ├─ HandLandmarker  (every frame, ~30 fps)      → landmarksRef
  ├─ stateMachine.reduce(prev, frame)            → GestureEvent[]
  ├─ compositor.draw(video, mask, debug)         → <canvas>
  └─ events → gestureBus → zustand stores

React tree re-renders only on store slice changes.
```

- **Per-frame data (landmarks, masks, smoothed cursor coords) lives in React refs.** Never put it in zustand or component state — it will thrash React at 30 fps.
- **Only discrete gesture events reach the zustand stores.** Event names: `pointer:move`, `pinch:down`, `pinch:up`, `zoom:delta`, `voice:command`.
- **Compositor draws to canvas every frame without re-rendering React.**
- Use `zustand` per-slice selectors (`useWindows(s => s.list)`), not whole-store subscriptions.

## Gesture state machine invariants

States: `IDLE | POINTING | PINCH_PENDING | PINCH_DOWN | DRAGGING | ZOOMING`. Pure reducer `(prev, frame) → { state, events[] }` in `src/gestures/stateMachine.ts`.

Non-negotiable rules (break any of these and clicks feel broken, not just wrong):

- **Freeze cursor on pinch-start.** When entering `PINCH_PENDING`, latch the smoothed cursor position for 4 frames. Emit `pinch:down` at the latched position, not the live fingertip. Without this every click lands 8–15 px off-target.
- **Hysteresis between pinch-in and pinch-out thresholds.** Pinch-in at `pinchDist < 0.35`, pinch-out at `pinchDist > 0.50`. The 0.15 gap is the #1 feel-tuning knob.
- **ZOOMING gate on all-5-fingers-extended.** This guarantees zoom can never collide with POINTING (which requires exactly-1 extended).
- **One-euro filter for cursor smoothing** (`minCutoff=1.0, beta=0.02`) — what MediaPipe uses internally. Not Kalman, not EMA.
- **Mirror landmarks' x-coords before any viewport mapping** if the video is displayed mirrored (it should be — matches user intuition). `x = 1 - x`. Forget this and everything is flipped.

## MediaPipe asset loading

- Use `@mediapipe/tasks-vision` only. The legacy `@mediapipe/hands` solutions API is deprecated and must not be added.
- WASM assets are copied from `node_modules/@mediapipe/tasks-vision/wasm/` into `public/mediapipe/wasm/` by `scripts/copy-mediapipe-assets.mjs` (runs on `npm install`). Load via `FilesetResolver.forVisionTasks("/mediapipe/wasm")`. Do not load from jsDelivr — MediaPipe has shipped CDN versions missing the wasm folder (GH issue #5647).
- Model files (`hand_landmarker.task`, `selfie_multiclass_256x256.tflite`) are downloaded by the same postinstall script into `public/mediapipe/models/`. The whole `public/mediapipe/` directory is gitignored — regenerated on each install.
- We use the **multiclass** selfie model (6 classes: bg, hair, body-skin, face-skin, clothes, other), not the simpler `selfie_segmenter`. The simple model is trained on video-call torsos and drops extended hands / back-of-hand views. For compositing we read `confidenceMasks[0]` (bg probability) and invert to `1 - bg` = person confidence.

## Performance budget (per frame)

- Compositor ≤ 6 ms
- MediaPipe (staggered: landmarker every frame, segmenter every 2nd) ≤ 10 ms
- React commits ≤ 2 ms
- Target 60 fps on M1 MacBook, floor 30 fps on integrated Intel.
- `HandLandmarker`: `runningMode: "VIDEO"`, `numHands: 1`, `delegate: "GPU"` (with CPU fallback).

## Testing gestures without a webcam

Gesture detectors are pure functions on `number[][]` landmark arrays. Unit-test them with fixture data:

1. In dev, press `Shift+F` (wired in M3) to dump the current landmark array to the clipboard as JSON.
2. Save to `src/test/fixtures/*.json` — one file per pose (static-point, static-fist, mid-pinch, drag-sweep, edge-of-frame, etc.).
3. Vitest asserts detectors + state-machine transitions against the fixtures:

```ts
reduce(IDLE, [point, point, pinch, pinch, pinch, release])
  → emits [pointer:move, ..., pinch:down, pinch:up]
```

This is the only CI-safe way to prove gesture logic correct. Don't skip it.

## Directory conventions

- `src/gestures/` — pure functions, no DOM, no React, no side effects. Unit-tested.
- `src/lib/` — browser primitives (canvas, WebGL, video frame loop). No React.
- `src/hooks/` — React glue that wires `lib/` to components via refs + stores.
- `src/stores/` — zustand stores. Only accept discrete events, never per-frame data.
- `src/components/` — presentational. Subscribe to store slices, not whole stores.
- `src/apps/` — mock apps. Each in its own folder with a `manifest.ts` exporting `{ id, name, icon, defaultSize, component }`.
- `@/` alias → `src/`. Use it in imports.

## What NOT to do in this codebase

- Don't install `react-rnd` — its HTML5 mouse model fights the synthetic gesture cursor. Build `Window.tsx` by hand (~120 lines) subscribing to `gestureBus`.
- Don't use CSS `filter: blur()` for background blur. It's 3–5× slower than a two-pass WebGL gaussian and jitters on Chromium.
- Don't pipe iframes of Google/Spotify into windows — those sites send `X-Frame-Options: DENY`. Build mock React components for v1; real integrations (Spotify Web Playback SDK, Google Custom Search) land after Supabase auth.
- Don't run segmenter + landmarker both every frame — stagger them. Segmenter @ 15 fps, landmarker @ 30 fps.
