import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export interface UseMediaPipeResult {
  segmenterRef: React.MutableRefObject<ImageSegmenter | null>;
  ready: boolean;
  error: string | null;
}

const WASM_BASE = '/mediapipe/wasm';
// Multiclass model: 6 confidence masks (0=bg, 1=hair, 2=body-skin, 3=face-skin, 4=clothes,
// 5=other). Trained on full-body data so hands/arms away from torso and back-of-hand views
// segment correctly — the simpler selfie_segmenter drops them.
const SEGMENTER_MODEL = '/mediapipe/models/selfie_multiclass_256x256.tflite';

// Bootstraps MediaPipe Tasks Vision. Segmenter lives in a ref so the frame loop can read it
// without re-renders. HandLandmarker joins this hook in M3.
export function useMediaPipe(): UseMediaPipeResult {
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let localSegmenter: ImageSegmenter | null = null;

    const boot = async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        localSegmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: SEGMENTER_MODEL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        if (cancelled) {
          localSegmenter.close();
          return;
        }
        segmenterRef.current = localSegmenter;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void boot();

    return () => {
      cancelled = true;
      segmenterRef.current = null;
      if (localSegmenter) localSegmenter.close();
    };
  }, []);

  return { segmenterRef, ready, error };
}
