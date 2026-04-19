import { useEffect, useRef } from 'react';
import { useCamera } from '@/hooks/useCamera';
import { useMediaPipe } from '@/hooks/useMediaPipe';
import { startFrameLoop, makeFpsTracker } from '@/lib/frameLoop';
import { createCompositor, type MaskBuffer } from '@/lib/compositor';

export interface CameraCanvasProps {
  fpsRef?: { current: number };
}

// Temporal max-decay on the mask: new = max(current, prev * DECAY). Prevents single-frame
// confidence dropouts (e.g. when a hand suddenly enters the scene) from causing the face to flash
// transparent. Higher = stickier mask (ghosting); lower = snappier (more flicker). 0.85 ≈ 5 frames.
const MASK_DECAY = 0.85;

// Drives the full-screen canvas. Pipeline per frame:
//   1. segmenter.segmentForVideo(video, timestamp) -> confidence mask
//   2. Apply temporal max-decay, update mask ref
//   3. compositor.draw(video, mask) -> blurred bg + sharp masked subject
// Per-frame data (mask, fps) stays in refs so React never re-renders on the hot path.
export function CameraCanvas({ fpsRef }: CameraCanvasProps) {
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();
  const { segmenterRef, ready: pipeReady, error: pipeError } = useMediaPipe();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<MaskBuffer | null>(null);

  useEffect(() => {
    if (!cameraReady) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const compositor = createCompositor(canvas);
    const fps = makeFpsTracker();
    let decayBuf: Float32Array | null = null;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const stop = startFrameLoop(video, (dt, now) => {
      fps.sample(dt);
      if (fpsRef) fpsRef.current = fps.ref.current;

      const segmenter = segmenterRef.current;
      if (segmenter) {
        const result = segmenter.segmentForVideo(video, Math.round(now));
        // Multiclass model: confidenceMasks[0] is the background probability. Person = 1 - bg.
        const bgMask = result.confidenceMasks?.[0];
        if (bgMask) {
          const w = bgMask.width;
          const h = bgMask.height;
          const bgSrc = bgMask.getAsFloat32Array();
          if (!decayBuf || decayBuf.length !== bgSrc.length) {
            decayBuf = new Float32Array(bgSrc.length);
          }
          for (let i = 0; i < bgSrc.length; i++) {
            const person = 1 - bgSrc[i];
            const prev = decayBuf[i] * MASK_DECAY;
            decayBuf[i] = person > prev ? person : prev;
          }
          maskRef.current = { data: decayBuf, width: w, height: h };
          bgMask.close();
        }
        result.close();
      }

      compositor.draw(video, maskRef.current);
    });

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      compositor.dispose();
      maskRef.current = null;
      decayBuf = null;
    };
  }, [cameraReady, videoRef, segmenterRef, fpsRef]);

  const err = cameraError ?? pipeError;
  const loadingLabel = !cameraReady
    ? 'requesting camera...'
    : !pipeReady
      ? 'loading vision models...'
      : null;

  return (
    <>
      <video ref={videoRef} className="hidden" />
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" style={{ zIndex: 0 }} />
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
