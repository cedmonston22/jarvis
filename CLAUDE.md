# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Meta-Ray-Bans / Apple-Vision-Pro-style web app. The webcam fills the screen, and floating "app" windows live around the user. All interaction is gesture (hand tracking via MediaPipe) + voice (Web Speech API, later). Real Google/Spotify API integrations and Supabase auth are deliberately deferred — v1 ships with mock apps so gesture UX can be validated first.

The full approved architecture and milestone plan lives at `C:\Users\cgedm\.claude\plans\tender-sprouting-cerf.md`. Read it before making non-trivial changes. Project memory at `C:\Users\cgedm\.claude\projects\C--Users-cgedm-documents-github-jarvis\memory\MEMORY.md` tracks milestone progress + user preferences that aren't in code.

## Commands

```bash
npm install        # also runs postinstall: copies MediaPipe WASM + downloads model files into public/mediapipe/
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
  │ requestVideoFrameCallback loop (src/lib/frameLoop.ts in CameraCanvas)
  ├─ brightness/contrast preprocess → detection canvas (helps in low light)
  ├─ HandLandmarker.detectForVideo(detectionCanvas)      → landmarksRef (x-mirrored)
  │                                                      → rawHandsRef (video-space)
  ├─ compositor.draw(video, null, rawHands)              → bg canvas (z=0), subject canvas (z=30)
  │                                                        (subject canvas inert right now — see below)
  │
  │ separate RAF loop (src/hooks/useGestures.ts)
  ├─ stateMachine.reduce(prev, {hand: hands[0], t, viewport}) → events
  ├─ per-hand airTap.stepTapDetector(straightness, clickOk)    → click events
  └─ events → GestureBus → PinchTarget subscribers

React tree re-renders only on discrete event subscriptions (hover, press, click, drag).
```

- **Per-frame data (landmarks, masks, cursor coords, z history) lives in React refs.** Never put it in React state — it will thrash React at 30 fps.
- **Only discrete gesture events cross the boundary into React.** Event types live in `src/gestures/bus.ts`: `pointer:move`, `click`, `pinch:down`, `pinch:up`, `drag:start`, `drag:move`, `drag:end`, `zoom:delta`.
- **Bus is distributed via React context** (`GestureBusProvider` in Stage, `useGestureBus` hook). No zustand yet — add it only if a later milestone (window stacking, focus) needs multi-component shared state.
- **Compositor draws to canvas every frame without re-rendering React.**

### Current pipeline notes (read this before touching camera/compositor)

- **Segmenter is disabled.** `src/components/CameraCanvas.tsx` has the segmenter invocation commented out. Compositor still runs with `blurRadiusPx: 0` and `bgOvershoot: 1.0`, which collapses to "draw mirrored video to bg canvas, subject canvas stays empty". Hand appears *behind* tiles. To re-enable Vision-Pro layering: uncomment the segmenter block and set `blurRadiusPx: 12`. Infrastructure (useMediaPipe's ImageSegmenter, hand-boost, two-canvas setup) is intact.
- **MediaPipe detection runs on the raw `<video>` directly.** A brightness/contrast preprocess canvas was removed because it clipped highlights in well-lit rooms and degraded landmark quality more than it helped. If low-light tracking becomes an issue, gate any preprocess on a luminance check rather than applying unconditionally.

## Gesture state machine invariants

States: `IDLE | POINTING | PINCH_PENDING | PINCH_DOWN | DRAGGING | ZOOMING`. Pure reducer `(prev, frame) → { state, events[] }` in `src/gestures/stateMachine.ts`. Click detection is separate — in `src/gestures/detectors/airTap.ts` (filename is legacy; it's a finger-curl detector now, not z-velocity).

Non-negotiable rules (break any and gestures feel broken, not just wrong):

- **Freeze cursor on pinch-start.** When entering `PINCH_PENDING`, latch the smoothed cursor position for `pinchFreezeFrames`. Emit `pinch:down` at the latched position, not the live fingertip. Without this every click lands 8–15 px off-target.
- **Hysteresis between pinch-in and pinch-out.** Current values in `DEFAULT_TUNING` — the #1 feel-tuning knob. Pinch distance uses `min(3D ratio, 2D ratio)` of thumb-tip ↔ index-tip over index-finger-length so both side-facing and front-facing pinches stay stable (one view compensates when the other is unreliable).
- **Click is finger-curl.** The user flexes the index slightly and re-extends; detector sees a V-shape in 2D-only `fingerStraightness2D`. 2D is deliberate — MediaPipe's z is noisy at distance, and curl happens in the image plane anyway. Clicks are force-suppressed while pinching/dragging (see `useGestures`).
- **ZOOMING gate on all-5-fingers-extended.** This guarantees zoom can never collide with POINTING (which requires exactly-1 extended).
- **Mirror landmarks' x-coords before any viewport mapping.** `x = 1 - x` in CameraCanvas. Forget this and everything is flipped.
- **Grace windows matter.** `pointerExitFrames` keeps POINTING alive through a brief tilt/stumble; pinch distance is EMA-smoothed inside the state machine so single-frame landmark jitter doesn't flip modes.

## Visual feedback conventions

- **The fingertip IS the cursor** — no separate cursor DOM element. Hit-testing uses the fingertip's viewport pixel position from bus events.
- **Hand overlay** (`src/components/HandOverlay.tsx`) draws skeleton + dots for debugging. Per-landmark EMA smoothing for display only (gesture detectors see the raw landmarks). Toggle with `D` key.
- **Tile state mapping** (`PinchTarget`): idle → subtle border; hover → blue border + glow; pressed/dragging → bright accent border + fill + stronger glow. Don't scale-down on press (user dislikes it).
- **Click ripple** — a blue expanding ring at the click point, always on. Fires only on `click` events (gated to POINTING/IDLE mode).

## MediaPipe asset loading

- Use `@mediapipe/tasks-vision` only. The legacy `@mediapipe/hands` solutions API is deprecated and must not be added.
- WASM assets are copied from `node_modules/@mediapipe/tasks-vision/wasm/` into `public/mediapipe/wasm/` by `scripts/copy-mediapipe-assets.mjs` (runs on `npm install`). Load via `FilesetResolver.forVisionTasks("/mediapipe/wasm")`. Do not load from jsDelivr — MediaPipe has shipped CDN versions missing the wasm folder (GH issue #5647).
- Model files (`hand_landmarker.task`, `selfie_multiclass_256x256.tflite`) are downloaded by the same postinstall script into `public/mediapipe/models/`. The whole `public/mediapipe/` directory is gitignored — regenerated on each install. The selfie segmenter model is currently unused (see "pipeline notes" above) but kept for re-enablement.
- `HandLandmarker` config: `runningMode: "VIDEO"`, `numHands: 2`, `delegate: "GPU"`, all three confidence thresholds at `0.5` (MediaPipe default — was 0.15 originally but that returned low-quality landmarks and the gesture layer can't filter noise below the model's confidence).

## Performance budget (per frame)

- MediaPipe landmarker (every frame, GPU delegate): ~5–10 ms
- Hand overlay draw + ripples: ~1 ms
- Target 60 fps, floor ~25 fps at 1080p with 2-hand tracking. Drop camera request back to 720p if FPS dips below 20.
- React commits ≤ 2 ms (gated by discrete event handlers only).

## Testing gestures without a webcam

Gesture detectors are pure functions on `Hand` arrays (21-landmark `{x,y,z}`). Unit-test them with fixture data:

1. In dev, press `Shift+F` to dump the current landmark array to the clipboard as JSON.
2. Save to `src/test/fixtures/*.json` — one file per pose (static-point, static-fist, mid-pinch, drag-sweep, edge-of-frame, etc.).
3. Vitest asserts detectors + state-machine transitions against the fixtures (or against `makeHand()` synthetic hands for predictable geometry):

```ts
reduce(IDLE, [point, point, pinch, pinch, pinch, release])
  → emits [pointer:move, ..., pinch:down, pinch:up]
```

This is the only CI-safe way to prove gesture logic correct. Don't skip it.

## Directory conventions

- `src/gestures/` — pure functions, no DOM, no React, no side effects. Unit-tested. Includes `bus.ts`, `BusContext.tsx`, `useGestureBus.ts`, `stateMachine.ts`, `fingers.ts`, `handTopology.ts`, `oneEuro.ts`, `types.ts`, and `detectors/{pointer,pinch,spread,airTap}.ts`.
- `src/lib/` — browser primitives (canvas, video frame loop, compositor). No React.
- `src/hooks/` — React glue that wires `lib/` to components via refs (`useCamera`, `useMediaPipe`, `useGestures`).
- `src/components/` — presentational. Subscribe to bus events, not whole stores. `PinchTarget` is the reusable hit-testable primitive.
- `src/apps/` — mock apps (not yet created; M10).
- `src/test/fixtures/` — hand fixture JSON + `makeHand()` synthetic hand factory.
- `@/` alias → `src/`. Use it in imports.

## What NOT to do in this codebase

- Don't install `react-rnd` — its HTML5 mouse model fights the synthetic gesture cursor. Build windows by hand (reuse the `PinchTarget` drag pattern).
- Don't pipe iframes of Google/Spotify into windows — those sites send `X-Frame-Options: DENY`. Build mock React components for v1; real integrations (Spotify Web Playback SDK, Google Custom Search) land after Supabase auth.
- Don't revive z-velocity tap detection. User explicitly prefers finger-curl clicks; the previous z-velocity model couldn't distinguish taps from tilts.
- Don't re-enable blur/subject-cutout without checking with the user. They turned it off because halos around the hand were visible when it overlapped tiles, and tightening the mask gave jaggy edges. See `feedback_blur_and_subject_cutout_disabled` memory.
- Don't add heavy smoothing to the gesture signals by default — the user tuned thresholds against the current (moderate) smoothing. Aggressive smoothing breaks click responsiveness.
