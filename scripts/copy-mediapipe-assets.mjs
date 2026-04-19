// Copies MediaPipe WASM assets and downloads .task model files into public/mediapipe/.
// Runs via `postinstall`. Idempotent: models are only downloaded when missing.
// WASM is always re-copied so an upgrade of tasks-vision picks up the new files.

import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = resolve(root, 'public/mediapipe/wasm');
const modelsDst = resolve(root, 'public/mediapipe/models');

const MODELS = [
  {
    name: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  },
  {
    name: 'selfie_multiclass_256x256.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  },
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    console.warn('[mediapipe] wasm source missing — tasks-vision not installed yet. Skipping.');
    return;
  }
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('[mediapipe] wasm -> public/mediapipe/wasm');
}

async function downloadModel({ name, url }) {
  const out = join(modelsDst, name);
  if (await exists(out)) {
    console.log(`[mediapipe] ${name} already present.`);
    return;
  }
  await mkdir(modelsDst, { recursive: true });
  console.log(`[mediapipe] downloading ${name}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`[mediapipe] ${name} -> public/mediapipe/models/ (${buf.byteLength} bytes)`);
}

await copyWasm();
for (const m of MODELS) {
  try {
    await downloadModel(m);
  } catch (e) {
    console.warn(`[mediapipe] failed to download ${m.name}: ${e.message}`);
    console.warn('[mediapipe] the app will not work until these are present in public/mediapipe/models/');
  }
}
