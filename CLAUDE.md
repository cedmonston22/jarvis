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
  ├─ HandLandmarker.detectForVideo(video)  → landmarksRef (x-mirrored, viewport-space)
  │                                        → rawHandsRef (video-space, for compositor)
  └─ compositor.draw(video, null, rawHands) → bg canvas (z=0), subject canvas (z=30, inert)

separate RAF loop in src/hooks/useGestures.ts, per frame:
  1. step per-hand airTap + forwardTap click detectors
  2. reduce(stateMachine, {hand: hands[0], t, viewport, suppressPinch}) on primary hand
  3. emit click events for any tap that fired
  4. step per-hand handPinch detectors → emit hand:pinch:* AND bimanual:pinch:* events

React tree re-renders only on discrete event subscriptions (hover, press, click, drag, anchor-lock).
```

- **Per-frame data (landmarks, smoothed values, streak counters) lives in React refs.** Never put it in React state — it will thrash React at 30 fps.
- **Only discrete gesture events cross the boundary into React.** Event types live in `src/gestures/bus.ts`: `pointer:move`, `click`, `pinch:down`, `pinch:up`, `drag:start`, `drag:move`, `drag:end`, `bimanual:pinch:start`, `bimanual:pinch:move`, `bimanual:pinch:end`, `hand:pinch:start`, `hand:pinch:move`, `hand:pinch:end`.
- **Bus is distributed via React context** (`GestureBusProvider` in Stage, `useGestureBus` hook). Window state lives in a zustand store (`src/stores/windowStore.ts`) — everything else sticks to bus + refs.
- **Compositor draws to canvas every frame without re-rendering React.**

### Current pipeline notes (read this before touching camera/compositor)

- **Segmenter is disabled.** `src/components/CameraCanvas.tsx` has the segmenter invocation commented out. Compositor still runs with `blurRadiusPx: 0` and `bgOvershoot: 1.0`, which collapses to "draw mirrored video to bg canvas, subject canvas stays empty". Hand appears *behind* windows. To re-enable Vision-Pro layering: uncomment the segmenter block and set `blurRadiusPx: 12`. Infrastructure (useMediaPipe's ImageSegmenter, hand-boost, two-canvas setup) is intact.
- **MediaPipe detection runs on the raw `<video>` directly.** A brightness/contrast preprocess canvas was tried and removed because it clipped highlights in well-lit rooms and degraded landmark quality more than it helped. If low-light tracking becomes an issue, gate any preprocess on a luminance check rather than applying unconditionally.

## Gesture state machine invariants

States: `IDLE | POINTING | PINCH_PENDING | PINCH_DOWN | DRAGGING`. Pure reducer `(prev, frame) → { state, events[] }` in `src/gestures/stateMachine.ts`. The reducer is **single-hand** (primary only). Click detection is separate (two detectors, see below). **Zoom and resize are bimanual** — handled outside the state machine in `useGestures` + `WindowManager`.

Non-negotiable rules (break any and gestures feel broken, not just wrong):

- **Pinch is decoupled from POINTING pose.** `IDLE → PINCH_PENDING` fires directly on `pinchDist < pinchIn`, no pose prerequisite. `POINTING` is just a convenience state for cursor emission — it's no longer a gate for pinch. IDLE also emits `pointer:move` every frame a hand is visible so hover works without a formal pointing pose.
- **Freeze cursor on pinch-start.** On entering `PINCH_PENDING`, latch the smoothed cursor position for `pinchFreezeFrames`. Emit `pinch:down` at the latched position, not the live fingertip. Without this every click lands 8–15 px off-target.
- **Hysteresis between pinchIn/pinchOut + release-hold streak.** Current values in `DEFAULT_TUNING`. `pinchReleaseStreak` delays `pinch:up`/`drag:end` until pinchDist stays above `pinchOut` for `pinchReleaseHoldFrames` consecutive frames — filters mid-drag jitter without making release feel sticky. Pinch distance uses `min(3D ratio, 2D ratio)` of thumb-tip ↔ index-tip over index-finger-length so both side-facing and front-facing pinches stay stable.
- **Click has two detectors, both 2D.** `airTap.ts` watches a V-shape in `fingerStraightness2D` (finger-curl click). `forwardTap.ts` watches rapid growth in the hand's 2D bbox diagonal (hand-toward-camera tap). Either firing emits a `click` event. 2D is deliberate — MediaPipe's z is noisy; 2D bbox is also immune to the tilts-as-taps failure mode that killed the original z-velocity detector.
- **Click / pinch are mutually gated.** `useGestures` suppresses clicks while the primary is `PINCH_*` or `DRAGGING` (force-cooldown). The state machine refuses to enter `PINCH_PENDING` while the primary tap detector's phase is `CURLING` (via `frame.suppressPinch`). Both directions of mutual lock are required to stop either from stealing the other.
- **PinchTarget: pinch-and-release over a target = click too.** When a pinch on a target releases without ever promoting to a drag, PinchTarget fires `onClick`. Gives pinch as a second click modality alongside the curl / forward-tap detectors.
- **`isPointerPose` uses 2D, asymmetric thresholds.** `fingerStraightness2D` > 0.3 for index (permissive — bent pinch still counts as pointing); > 0.55 for middle/ring/pinky (strict — so a relaxed neighbor doesn't satisfy "not extended"). z is too noisy front-facing for a 3D pose gate.
- **Mirror landmarks' x-coords before any viewport mapping.** `x = 1 - x` in CameraCanvas. Forget this and everything is flipped.
- **Grace windows.** `pointerExitFrames` keeps POINTING alive through a brief tilt/stumble. Pinch distance is EMA-smoothed inside the state machine so single-frame landmark jitter doesn't flip modes.

## Window manager

Windows are stored in a zustand store (`src/stores/windowStore.ts`): `{ windows: Record<id, WindowState>, focusOrder: string[] }`. One window per app (re-opening focuses). `moveWindow` and `resizeWindow` both clamp against an off-screen buffer (`OFFSCREEN_BUFFER = 100`) so the user can always grab a window back.

`WindowManager.tsx` orchestrates all bimanual interaction:

- **Focus follows pinch.** On `pinch:down`, the topmost window under the point is brought to front.
- **8 grip zones per window** (4 corners + 4 sides, OVERLAPPING): `T/B/L/R` plus `TL/TR/BL/BR`. Zone split is outer-20%/middle-60%/outer-20% on each axis. Corners = outer 20% on BOTH axes; sides = outer 20% on one axis only; middle = zoom zone.
- **Bimanual mode is decided on `:start` and locked:**
  - Opposing corners (TL+BR or TR+BL) → `resize-2d`. Aspect preserved; scale = currentDist / initialDist; window scales around its starting center.
  - Opposing sides (L+R) → `resize-horizontal`. Width only.
  - Opposing sides (T+B) → `resize-vertical`. Height only.
  - Middle (no grip match) → `zoom`. Uses `|a.x - b.x|` only (horizontal distance) to drive `window.zoom`.
  - Anything else (mixed, non-opposing, different windows) → nothing fires.
- **Live anchor feedback.** `hand:pinch:*` events let `WindowManager` light up individual L-bracket / edge-tick handles the moment a hand is pinching over them — not just when a full bimanual gesture confirms. Users see per-hand commitment before attempting the motion.

App content is rendered inside `AppFrame`, which applies `transform: scale(win.zoom)` so the window chrome stays fixed size while the body scales.

## Visual feedback conventions

- **The fingertip IS the cursor** — no separate cursor DOM element. Hit-testing uses the fingertip's viewport pixel position from bus events.
- **Hand overlay** (`src/components/HandOverlay.tsx`) draws skeleton + dots for debugging. Per-landmark EMA smoothing for display only (gesture detectors see the raw landmarks). Toggle with `D` key.
- **Tile/window state mapping** (`PinchTarget`): idle → subtle border; hover → blue border + glow; pressed/dragging → bright accent border + fill + stronger glow. Don't scale-down on press (user dislikes it).
- **Click ripple** — blue expanding ring at the click point. Fires only on `click` events.
- **Grip anchors** (on windows): corner L-brackets and side ticks. Idle = 35% white outline; active = bright accent with drop-shadow glow. When any grip is locked the whole window gains a soft accent ring.

## MediaPipe asset loading

- Use `@mediapipe/tasks-vision` only. The legacy `@mediapipe/hands` solutions API is deprecated and must not be added.
- WASM assets are copied from `node_modules/@mediapipe/tasks-vision/wasm/` into `public/mediapipe/wasm/` by `scripts/copy-mediapipe-assets.mjs` (runs on `npm install`). Load via `FilesetResolver.forVisionTasks("/mediapipe/wasm")`. Do not load from jsDelivr — MediaPipe has shipped CDN versions missing the wasm folder (GH issue #5647).
- Model files (`hand_landmarker.task`, `selfie_multiclass_256x256.tflite`) are downloaded by the same postinstall script into `public/mediapipe/models/`. The whole `public/mediapipe/` directory is gitignored — regenerated on each install. The selfie segmenter model is currently unused (see "pipeline notes") but kept for re-enablement.
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
3. Vitest asserts detectors + state-machine transitions against the fixtures (or against `makeHand()` synthetic hands for predictable geometry).

The state-machine tests use a relaxed `pinchIn`/`pinchOut` TUNING (0.55/0.90) rather than prod defaults so they exercise transitions, not the EMA smoothing — see top of `stateMachine.test.ts`.

## Directory conventions

- `src/gestures/` — pure functions, no DOM, no React, no side effects. Unit-tested. Includes `bus.ts`, `BusContext.tsx`, `useGestureBus.ts`, `stateMachine.ts`, `fingers.ts`, `handTopology.ts`, `oneEuro.ts`, `types.ts`, and `detectors/{pointer.ts, airTap.ts, forwardTap.ts, handPinch.ts, spread.ts}`.
- `src/lib/` — browser primitives (canvas, video frame loop, compositor). No React.
- `src/hooks/` — React glue (`useCamera`, `useMediaPipe`, `useGestures`).
- `src/components/` — presentational. Subscribe to bus events. `PinchTarget` is the reusable hit-testable primitive. Window UI lives in `components/window/{WindowManager,Window,AppFrame}.tsx`.
- `src/stores/` — zustand stores. Currently `windowStore.ts` (window positions, sizes, zoom, focus order).
- `src/apps/` — mock apps. `registry.ts` exports the `APPS` manifest + `APP_ORDER`; each app has its own folder (e.g. `GoogleMock/index.tsx`). M8 ships with stub components; M10 fleshes them out.
- `src/test/fixtures/` — hand fixture JSON + `makeHand()` synthetic hand factory.
- `@/` alias → `src/`. Use it in imports.

## What NOT to do in this codebase

- Don't install `react-rnd` — its HTML5 mouse model fights the synthetic gesture cursor. Build windows by hand (reuse the `PinchTarget` drag pattern).
- Don't pipe iframes of Google/Spotify into windows — those sites send `X-Frame-Options: DENY`. Build mock React components for v1; real integrations (Spotify Web Playback SDK, Google Custom Search) land after Supabase auth.
- Don't re-add ZOOMING to the state machine. Zoom is bimanual and lives in `WindowManager`. Single-hand spread-to-zoom was tried multiple ways (continuous, flick-velocity, cumulative-delta) and all tripped on the "fingers return to rest" motion. Bimanual is the resolution.
- Don't revive the original z-velocity tap detector — the tilts-as-taps failure mode was the whole reason it was scrapped. If "hand toward camera" click accuracy needs work, tune `forwardTap.ts` (bbox-growth-based, 2D, immune to tilts) rather than adding z signals back.
- Don't re-enable blur/subject-cutout without checking with the user. They turned it off because halos around the hand were visible when it overlapped tiles, and tightening the mask gave jaggy edges. See `feedback_blur_and_subject_cutout_disabled` memory.
- Don't add heavy smoothing to the gesture signals by default — the user tuned thresholds against the current smoothing coefficients. Aggressive smoothing breaks click responsiveness.
- Don't widen the grip zones past ~20%/60%/20%. Wider outer bands (tried 40% and 30%) make zooms accidentally trip resize when pinching inside a window. 20% bands with live anchor feedback is the current balance.
