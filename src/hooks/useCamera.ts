import { useEffect, useRef, useState } from 'react';

export interface UseCameraOptions {
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  ready: boolean;
  error: string | null;
}

// Requests user-facing webcam and attaches the stream to a <video> ref.
// Caller attaches videoRef to a (hidden) <video> element. We await playback before setting ready.
export function useCamera(opts: UseCameraOptions = {}): UseCameraResult {
  const { width = 1920, height = 1080, frameRate = 30 } = opts;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: frameRate },
            facingMode: 'user',
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [width, height, frameRate]);

  return { videoRef, ready, error };
}
