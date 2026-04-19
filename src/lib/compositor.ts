// Two-layer compositor: blurred mirrored video on the bottom, sharp mirrored video masked by the
// segmenter's confidence mask on top. Both layers share the same "object-fit: cover" + mirror
// transform so the mask aligns with the foreground video.
//
// Uses Canvas2D `ctx.filter = 'blur(Npx)'` for the bg, which is GPU-accelerated via Skia on
// Chromium. Upgrade to a two-pass WebGL gaussian if perf becomes a bottleneck.

import { HAND_CONNECTIONS } from '@/gestures/handTopology';
import type { Hands } from '@/gestures/types';

export interface Compositor {
  // `rawHands` is in non-mirrored video-space (matches mask-canvas coordinates). Painted on top
  // of the segmenter confidence mask so hands are forced into the sharp foreground even when the
  // segmenter's body mask loses them (extended arms, back-of-hand views).
  draw(video: HTMLVideoElement, mask: MaskBuffer | null, rawHands?: Hands): void;
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

// Two-canvas compositor so UI can live BETWEEN the blurred background and the sharp subject
// cutout (Vision-Pro-style layering: the user's body + hand occlude floating UI windows).
//
//   z=0   bgCanvas       — blurred mirrored video (opaque)
//   z=~   UI windows     — rendered by DOM between the two canvases
//   z=30  subjectCanvas  — masked sharp user + hand on transparent background
export function createCompositor(
  bgCanvas: HTMLCanvasElement,
  subjectCanvas: HTMLCanvasElement,
  opts: CompositorOptions = {},
): Compositor {
  const blurRadius = opts.blurRadiusPx ?? 0;
  const bgOvershoot = opts.bgOvershoot ?? 1.0;
  // Hard-edged mask: with blur disabled, any feathering creates a visible halo when the subject
  // cutout overlaps a tile. Narrow smoothstep + no dilation gives a near-binary cutout.
  const [edgeLo, edgeHi] = opts.maskEdge ?? [0.45, 0.55];
  const maskDilatePx = opts.maskDilatePx ?? 0;

  const bgCtx = bgCanvas.getContext('2d', { alpha: false });
  if (!bgCtx) throw new Error('compositor: bg 2D context unavailable');
  const subjectCtx = subjectCanvas.getContext('2d', { alpha: true });
  if (!subjectCtx) throw new Error('compositor: subject 2D context unavailable');

  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('compositor: mask 2D context unavailable');

  const draw: Compositor['draw'] = (video, mask, rawHands) => {
    const cw = bgCanvas.width;
    const ch = bgCanvas.height;
    if (!video.videoWidth || !video.videoHeight) return;

    // 1. Background layer: blurred mirrored video, oversized so blur-edge darkening is off-canvas.
    bgCtx.save();
    bgCtx.filter = `blur(${blurRadius}px)`;
    drawCoverMirrored(bgCtx, video, video.videoWidth, video.videoHeight, cw, ch, bgOvershoot);
    bgCtx.filter = 'none';
    bgCtx.restore();

    // Subject canvas must be fully cleared every frame — it has alpha and we don't want ghosts.
    subjectCtx.clearRect(0, 0, subjectCanvas.width, subjectCanvas.height);

    if (!mask) return;

    // 2. Paint the confidence mask with smoothstep edge tightening.
    if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
    }
    paintConfidenceMask(maskCtx, mask, edgeLo, edgeHi);

    // 2b. Boost: paint hand skeleton on top of the mask so hands stay sharp even when the
    // segmenter's body mask drops them. Uses the raw (non-mirrored) landmarks — mask canvas is
    // in video space, not viewport space.
    if (rawHands && rawHands.length) {
      paintHandBoost(maskCtx, rawHands, maskCanvas.width, maskCanvas.height);
    }

    // 3. Subject canvas: sharp mirrored video -> mask via destination-in.
    //    Mask is drawn with a small blur(dilate) + contrast boost which together act as a cheap
    //    morphological dilation, fattening thin parts (fingers) that the 256x256 mask undersamples.
    drawCoverMirrored(subjectCtx, video, video.videoWidth, video.videoHeight, cw, ch, 1);
    subjectCtx.globalCompositeOperation = 'destination-in';
    subjectCtx.save();
    if (maskDilatePx > 0) {
      subjectCtx.filter = `blur(${maskDilatePx}px) contrast(400%)`;
    }
    drawCoverMirrored(subjectCtx, maskCanvas, mask.width, mask.height, cw, ch, 1);
    subjectCtx.restore();
    subjectCtx.globalCompositeOperation = 'source-over';
  };

  return {
    draw,
    dispose() {
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

// Paints a hand-shaped white blob onto the mask canvas: dots at each landmark plus thick strokes
// along the MediaPipe skeleton. The existing mask dilation pass (blur + contrast) smooths these
// into a connected hand region, guaranteeing the hand lands in the sharp foreground layer even
// when the segmenter's confidence is weak there (extended arms, back-of-hand, fast motion).
function paintHandBoost(
  ctx: CanvasRenderingContext2D,
  hands: Hands,
  maskW: number,
  maskH: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  // Normalized stroke/dot radius — tuned so the halo is wider than a finger at typical hand
  // sizes (mask is usually 256x256; 6 px ≈ a finger's thickness in that resolution).
  const lineWidth = Math.max(3, Math.round(maskW * 0.03));
  const dotRadius = Math.max(2, Math.round(maskW * 0.025));
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const hand of hands) {
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand[a];
      const pb = hand[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * maskW, pa.y * maskH);
      ctx.lineTo(pb.x * maskW, pb.y * maskH);
    }
    ctx.stroke();
    for (const pt of hand) {
      ctx.beginPath();
      ctx.arc(pt.x * maskW, pt.y * maskH, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
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
