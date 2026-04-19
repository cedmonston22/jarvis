import { useEffect, useRef, useState } from 'react';
import {
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';

export interface UseMediaPipeResult {
  segmenterRef: React.MutableRefObject<ImageSegmenter | null>;
  landmarkerRef: React.MutableRefObject<HandLandmarker | null>;
  ready: boolean;
  error: string | null;
}

const WASM_BASE = '/mediapipe/wasm';
// Multiclass model: 6 confidence masks (0=bg, 1=hair, 2=body-skin, 3=face-skin, 4=clothes,
// 5=other). Trained on full-body data so hands/arms away from torso and back-of-hand views
// segment correctly — the simpler selfie_segmenter drops them.
const SEGMENTER_MODEL = '/mediapipe/models/selfie_multiclass_256x256.tflite';
const HAND_MODEL = '/mediapipe/models/hand_landmarker.task';

// Bootstraps MediaPipe Tasks Vision. Segmenter + hand landmarker live in refs so the frame loop
// can read them without re-renders. Both share the same WasmFileset — FilesetResolver is called
// once.
export function useMediaPipe(): UseMediaPipeResult {
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let segmenter: ImageSegmenter | null = null;
    let landmarker: HandLandmarker | null = null;

    const boot = async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        [segmenter, landmarker] = await Promise.all([
          ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            // Near MediaPipe defaults. Cleaner landmarks at normal ranges (cost: a hand very far
            // from the camera or partially out of frame may drop tracking instead of returning
            // low-quality landmarks — the gesture layer's hand-lost grace handles that).
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        ]);
        if (cancelled) {
          segmenter.close();
          landmarker.close();
          return;
        }
        segmenterRef.current = segmenter;
        landmarkerRef.current = landmarker;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void boot();

    return () => {
      cancelled = true;
      segmenterRef.current = null;
      landmarkerRef.current = null;
      if (segmenter) segmenter.close();
      if (landmarker) landmarker.close();
    };
  }, []);

  return { segmenterRef, landmarkerRef, ready, error };
}
