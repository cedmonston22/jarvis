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
}

// Drives the full-screen canvas. Pipeline per frame:
//   1. segmenter.segmentForVideo -> confidence mask + temporal max-decay -> maskRef
//   2. landmarker.detectForVideo -> normalized landmarks -> landmarksRef (x-mirrored)
//   3. compositor.draw(video, mask) -> blurred bg + sharp masked subject
// Per-frame data (mask, landmarks, fps) stays in refs so React never re-renders on the hot path.
export function CameraCanvas({ fpsRef, landmarksRef }: CameraCanvasProps) {
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();
  const { segmenterRef, landmarkerRef, ready: pipeReady, error: pipeError } = useMediaPipe();
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const subjectCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<MaskBuffer | null>(null);
  // Non-mirrored landmarks in video-space — fed to the compositor for mask augmentation so hands
  // stay sharp regardless of segmenter confidence. Parallels `landmarksRef` which is mirrored.
  const rawHandsRef = useRef<import('@/gestures/types').Hands>([]);

  useEffect(() => {
    if (!cameraReady) return;
    const video = videoRef.current;
    const bg = bgCanvasRef.current;
    const subject = subjectCanvasRef.current;
    if (!video || !bg || !subject) return;

    const compositor = createCompositor(bg, subject);
    const fps = makeFpsTracker();

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
      const landmarker = landmarkerRef.current;
      if (landmarker) {
        const result = landmarker.detectForVideo(video, ts);
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
  }, [cameraReady, videoRef, segmenterRef, landmarkerRef, fpsRef, landmarksRef]);

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
