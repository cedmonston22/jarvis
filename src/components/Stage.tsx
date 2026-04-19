import { useRef } from 'react';
import { CameraCanvas } from './CameraCanvas';
import { FpsHud } from './FpsHud';

// Top-level container for the camera canvas, future overlays (cursor, windows, dock), and HUD.
// Per-frame data lives in refs we pass down; components read them on their own cadence.
export function Stage() {
  const fpsRef = useRef(0);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <CameraCanvas fpsRef={fpsRef} />
      <FpsHud fpsRef={fpsRef} />
    </div>
  );
}
