// Two-layer compositor: blurred mirrored video on the bottom, sharp mirrored video masked by the
// segmenter's confidence mask on top. Both layers share the same "object-fit: cover" + mirror
// transform so the mask aligns with the foreground video.
//
// Uses Canvas2D `ctx.filter = 'blur(Npx)'` for the bg, which is GPU-accelerated via Skia on
// Chromium. Upgrade to a two-pass WebGL gaussian if perf becomes a bottleneck.

export interface Compositor {
  draw(video: HTMLVideoElement, mask: MaskBuffer | null): void;
  dispose(): void;
}

export interface MaskBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

export interface CompositorOptions {
  blurRadiusPx?: number;
  // Scale factor applied to the blurred background draw so the blur's edge-darkening falls outside
  // the visible canvas. Raise if increasing blur radius.
  bgOvershoot?: number;
  // smoothstep bounds applied to confidence values to tighten the silhouette edge. Values between
  // these two thresholds get mapped to 0..1; below is fully transparent, above is fully opaque.
  // Keep `lo` low so thin extremities (fingers) that have weak confidence stay in the sharp layer.
  maskEdge?: [number, number];
  // Pixels of dilation applied to the mask alpha. Fattens thin parts (fingers, hair strands) so
  // they survive the mask's low resolution (256x256). 0 disables.
  maskDilatePx?: number;
}

export function createCompositor(main: HTMLCanvasElement, opts: CompositorOptions = {}): Compositor {
  const blurRadius = opts.blurRadiusPx ?? 12;
  const bgOvershoot = opts.bgOvershoot ?? 1.06;
  const [edgeLo, edgeHi] = opts.maskEdge ?? [0.1, 0.45];
  const maskDilatePx = opts.maskDilatePx ?? 2;

  const mainCtx = main.getContext('2d', { alpha: false });
  if (!mainCtx) throw new Error('compositor: 2D context unavailable');

  const fg = document.createElement('canvas');
  const fgCtx = fg.getContext('2d');
  if (!fgCtx) throw new Error('compositor: fg 2D context unavailable');

  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('compositor: mask 2D context unavailable');

  const draw: Compositor['draw'] = (video, mask) => {
    const cw = main.width;
    const ch = main.height;
    if (!video.videoWidth || !video.videoHeight) return;

    // 1. Background layer: blurred mirrored video, oversized so blur-edge darkening is off-canvas.
    mainCtx.save();
    mainCtx.filter = `blur(${blurRadius}px)`;
    drawCoverMirrored(mainCtx, video, video.videoWidth, video.videoHeight, cw, ch, bgOvershoot);
    mainCtx.filter = 'none';
    mainCtx.restore();

    if (!mask) return;

    // 2. Paint the confidence mask with smoothstep edge tightening.
    if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
    }
    paintConfidenceMask(maskCtx, mask, edgeLo, edgeHi);

    // 3. Foreground layer: sharp mirrored video -> mask via destination-in.
    //    Mask is drawn with a small blur(dilate) + contrast boost which together act as a cheap
    //    morphological dilation, fattening thin parts (fingers) that the 256x256 mask undersamples.
    if (fg.width !== cw || fg.height !== ch) {
      fg.width = cw;
      fg.height = ch;
    }
    fgCtx.clearRect(0, 0, cw, ch);
    drawCoverMirrored(fgCtx, video, video.videoWidth, video.videoHeight, cw, ch, 1);
    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.save();
    if (maskDilatePx > 0) {
      fgCtx.filter = `blur(${maskDilatePx}px) contrast(400%)`;
    }
    drawCoverMirrored(fgCtx, maskCanvas, mask.width, mask.height, cw, ch, 1);
    fgCtx.restore();
    fgCtx.globalCompositeOperation = 'source-over';

    // 4. Stack the masked sharp layer over the blurred background.
    mainCtx.drawImage(fg, 0, 0);
  };

  return {
    draw,
    dispose() {
      fg.width = fg.height = 0;
      maskCanvas.width = maskCanvas.height = 0;
    },
  };
}

// Writes confidence values into an ImageData's alpha channel with a smoothstep curve so soft mask
// gradients become crisp silhouettes. RGB is solid white so `destination-in` preserves the
// underlying video color.
function paintConfidenceMask(
  ctx: CanvasRenderingContext2D,
  mask: MaskBuffer,
  lo: number,
  hi: number,
): void {
  const { data, width, height } = mask;
  const img = ctx.createImageData(width, height);
  const out = img.data;
  const span = hi - lo || 1e-6;
  for (let i = 0; i < data.length; i++) {
    const t = Math.min(1, Math.max(0, (data[i] - lo) / span));
    const s = t * t * (3 - 2 * t);
    const p = i * 4;
    out[p] = 255;
    out[p + 1] = 255;
    out[p + 2] = 255;
    out[p + 3] = Math.round(s * 255);
  }
  ctx.putImageData(img, 0, 0);
}

// Cover-fit draw with horizontal mirror. Crops source to match canvas aspect, then centers.
// `overshoot` scales the destination rect (>1 extends beyond the canvas; used to hide blur-edge
// darkening on the background layer).
function drawCoverMirrored(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  cw: number,
  ch: number,
  overshoot: number,
): void {
  const sourceAspect = sw / sh;
  const canvasAspect = cw / ch;
  let sx = 0;
  let sy = 0;
  let sWidth = sw;
  let sHeight = sh;
  if (sourceAspect > canvasAspect) {
    sWidth = sh * canvasAspect;
    sx = (sw - sWidth) / 2;
  } else {
    sHeight = sw / canvasAspect;
    sy = (sh - sHeight) / 2;
  }
  const dw = cw * overshoot;
  const dh = ch * overshoot;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.save();
  ctx.translate(cw - dx, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
  ctx.restore();
}
