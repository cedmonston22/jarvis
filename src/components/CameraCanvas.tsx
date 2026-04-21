import { useEffect, useRef } from 'react';
import { useCamera } from '@/hooks/useCamera';
import { useMediaPipe } from '@/hooks/useMediaPipe';
import { startFrameLoop, makeFpsTracker } from '@/lib/frameLoop';
import { createCompositor, type MaskBuffer } from '@/lib/compositor';
import type { Hands } from '@/gestures/types';

export interface CameraCanvasProps {
  fpsRef: React.MutableRefObject<number>;
  // Output ref — we write detected hand landmarks here each frame. Pre-mirrored (x = 1 - x) so
  // downstream consumers (overlay, gestures) can treat coords as viewport-space-normalized.
  landmarksRef: React.MutableRefObject<Hands>;
  // Optional output refs — populated with the EMA-smoothed scene luminance (0..1) and the
  // current dark-mode gate state. Exposed so the HUD can surface when the low-light preprocess
  // has kicked in.
  lumaRef?: React.MutableRefObject<number>;
  darkModeRef?: React.MutableRefObject<boolean>;
}

// Drives the full-screen canvas. Pipeline per frame:
//   1. segmenter.segmentForVideo -> confidence mask + temporal max-decay -> maskRef
//   2. landmarker.detectForVideo -> normalized landmarks -> landmarksRef (x-mirrored)
//   3. compositor.draw(video, mask) -> blurred bg + sharp masked subject
// Per-frame data (mask, landmarks, fps) stays in refs so React never re-renders on the hot path.
export function CameraCanvas({ fpsRef, landmarksRef, lumaRef, darkModeRef: extDarkModeRef }: CameraCanvasProps) {
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();
  const { segmenterRef, landmarkerRef, ready: pipeReady, error: pipeError } = useMediaPipe();
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const subjectCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<MaskBuffer | null>(null);
  // Non-mirrored landmarks in video-space — fed to the compositor for mask augmentation so hands
  // stay sharp regardless of segmenter confidence. Parallels `landmarksRef` which is mirrored.
  const rawHandsRef = useRef<import('@/gestures/types').Hands>([]);
  // Adaptive low-light preprocess. We sample a tiny 32×32 downscale of the video each frame to
  // estimate luminance; when the room is too dark for MediaPipe, we blit video to a full-size
  // preprocess canvas with a brightness/contrast filter and feed THAT to the landmarker. The user-
  // visible compositor still reads from the raw video, so tone mapping only affects detection.
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const preprocessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedLumaRef = useRef<number>(0.5);
  const darkModeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!cameraReady) return;
    const video = videoRef.current;
    const bg = bgCanvasRef.current;
    const subject = subjectCanvasRef.current;
    if (!video || !bg || !subject) return;

    const compositor = createCompositor(bg, subject);
    const fps = makeFpsTracker();

    // Lazy-create the sampler + preprocess canvases. Sampler is fixed 32×32 (cheap readback);
    // preprocess canvas is sized to match the video stream on first use.
    if (!sampleCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      sampleCanvasRef.current = c;
    }
    if (!preprocessCanvasRef.current) {
      preprocessCanvasRef.current = document.createElement('canvas');
    }
    const sampleCtx = sampleCanvasRef.current.getContext('2d', { willReadFrequently: true });
    const preprocessCtx = preprocessCanvasRef.current.getContext('2d');

    const resize = () => {
      bg.width = window.innerWidth;
      bg.height = window.innerHeight;
      subject.width = window.innerWidth;
      subject.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const stop = startFrameLoop(video, (dt, now) => {
      fps.sample(dt);
      fpsRef.current = fps.ref.current;
      const ts = Math.round(now);

      // Segmentation mask intentionally disabled — bg blur is off and the hand-in-front-of-tiles
      // behavior was causing visible halos at the cutout edge. When we want blur/AR-layering back,
      // re-enable this block and the compositor will resume painting the subject canvas.
      //
      // const segmenter = segmenterRef.current;
      // if (segmenter) { ... writes to maskRef.current via decayBuf ... }

      // --- Hand landmarks ---
      // rawHandsRef gets MediaPipe's native coords (video-space, non-mirrored) for the compositor.
      // landmarksRef gets the x-mirrored copy for the overlay + gesture machine (viewport-space).
      // Low-light adaptive preprocess: sample avg luminance from a 32×32 downscale, EMA-smooth,
      // and hysteresis-gate a dark-mode flag. In dark mode we feed MediaPipe a brightness-lifted
      // copy of the frame; otherwise we pass video straight through. Unconditional preprocessing
      // was previously removed because it clipped highlights in well-lit rooms — gating on a
      // luminance measurement keeps the old failure mode away while rescuing low-light tracking.
      const landmarker = landmarkerRef.current;
      if (landmarker && video.videoWidth && video.videoHeight) {
        let detectInput: HTMLVideoElement | HTMLCanvasElement = video;
        if (sampleCtx) {
          // Whole-frame luma sample. An earlier attempt sampled from a bbox around the hand to
          // catch backlit subjects in bright scenes, but under normal lighting the bbox luma
          // swung wildly as the hand moved through light/shadow bands, flipping dark-boost on/off
          // rapidly. The brightness-boosted image then amplified noise enough that MediaPipe
          // started hallucinating phantom hands. Whole-frame sampling is stable but can't see
          // shadowed subjects in bright scenes — handling backlight cleanly needs a different
          // approach (camera track constraints, or sampling a quieter region of the frame).
          sampleCtx.drawImage(video, 0, 0, 32, 32);
          const pixels = sampleCtx.getImageData(0, 0, 32, 32).data;
          let sum = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          }
          const avgLuma = sum / (pixels.length / 4) / 255;
          smoothedLumaRef.current = 0.85 * smoothedLumaRef.current + 0.15 * avgLuma;
          const luma = smoothedLumaRef.current;
          // Hysteresis: enter dark mode at 0.35, exit at 0.45. Stops the preprocess from flipping
          // on/off at a single luma value (which would cause landmark positions to jump between
          // the two interpretations of the frame).
          if (darkModeRef.current && luma > 0.45) darkModeRef.current = false;
          else if (!darkModeRef.current && luma < 0.35) darkModeRef.current = true;
          if (lumaRef) lumaRef.current = luma;
          if (extDarkModeRef) extDarkModeRef.current = darkModeRef.current;
        }
        if (darkModeRef.current && preprocessCtx && preprocessCanvasRef.current) {
          const pc = preprocessCanvasRef.current;
          if (pc.width !== video.videoWidth || pc.height !== video.videoHeight) {
            pc.width = video.videoWidth;
            pc.height = video.videoHeight;
          }
          // Boost shadows without clipping highlights too hard. Contrast bump keeps edges crisp
          // for the landmarker after brightness lifts the mid-tones.
          preprocessCtx.filter = 'brightness(1.55) contrast(1.1)';
          preprocessCtx.drawImage(video, 0, 0);
          detectInput = pc;
        }
        const result = landmarker.detectForVideo(detectInput, ts);
        if (result.landmarks.length) {
          rawHandsRef.current = result.landmarks.map((hand) =>
            hand.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
          );
          landmarksRef.current = result.landmarks.map((hand) =>
            hand.map((pt) => ({ x: 1 - pt.x, y: pt.y, z: pt.z })),
          );
        } else if (landmarksRef.current.length) {
          landmarksRef.current = [];
          rawHandsRef.current = [];
        }
      }

      compositor.draw(video, maskRef.current, rawHandsRef.current);
    });

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      compositor.dispose();
      maskRef.current = null;
      landmarksRef.current = [];
      rawHandsRef.current = [];
    };
  }, [cameraReady, videoRef, segmenterRef, landmarkerRef, fpsRef, landmarksRef, lumaRef, extDarkModeRef]);

  const err = cameraError ?? pipeError;
  const loadingLabel = !cameraReady
    ? 'requesting camera...'
    : !pipeReady
      ? 'loading vision models...'
      : null;

  return (
    <>
      <video ref={videoRef} className="hidden" />
      {/* Blurred background layer — sits behind UI windows (z=0). */}
      <canvas
        ref={bgCanvasRef}
        className="fixed inset-0 h-full w-full"
        style={{ zIndex: 0 }}
      />
      {/* Sharp subject (person + hand) cutout — sits in front of UI windows (z=30) so the
          user physically occludes floating cards, matching Vision-Pro depth semantics. */}
      <canvas
        ref={subjectCanvasRef}
        className="pointer-events-none fixed inset-0 h-full w-full"
        style={{ zIndex: 30 }}
      />
      {err && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      )}
      {loadingLabel && !err && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-sm text-white/60">
          {loadingLabel}
        </div>
      )}
    </>
  );
}
