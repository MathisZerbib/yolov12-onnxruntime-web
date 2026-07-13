import * as ort from 'onnxruntime-web/webgpu';
import type { Detection, ModelMetadata } from '../lib/types';

ort.env.logLevel = 'error';

let session: ort.InferenceSession | null = null;
let metadata: ModelMetadata | null = null;
let inputCanvas: OffscreenCanvas | null = null;
const VEHICLE_CLASSES = new Set(['bicycle', 'car', 'motorcycle', 'bus', 'truck']);

function hex(buffer: ArrayBuffer): string { return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join(''); }

function nms(detections: Detection[], threshold: number): Detection[] {
  detections.sort((a, b) => b.confidence - a.confidence);
  const result: Detection[] = [];
  for (const candidate of detections) {
    const overlaps = result.some(other => {
      const left = Math.max(candidate.x, other.x), top = Math.max(candidate.y, other.y);
      const right = Math.min(candidate.x + candidate.width, other.x + other.width);
      const bottom = Math.min(candidate.y + candidate.height, other.y + other.height);
      if (right <= left || bottom <= top) return false;
      const intersection = (right - left) * (bottom - top);
      return intersection / (candidate.width * candidate.height + other.width * other.height - intersection) > threshold;
    });
    if (!overlaps) result.push(candidate);
  }
  return result;
}

function preprocess(bitmap: ImageBitmap): ort.Tensor {
  const [width, height] = metadata!.inputSize;
  inputCanvas ??= new OffscreenCanvas(width, height);
  const ctx = inputCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const dw = bitmap.width * scale, dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const plane = width * height, data = new Float32Array(plane * 3);
  for (let p = 0, i = 0; p < plane; p++, i += 4) { data[p] = pixels[i] / 255; data[p + plane] = pixels[i + 1] / 255; data[p + plane * 2] = pixels[i + 2] / 255; }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function postprocess(output: ort.Tensor, originalWidth: number, originalHeight: number, confidence: number): Detection[] {
  const [inputWidth, inputHeight] = metadata!.inputSize;
  const scale = Math.min(inputWidth / originalWidth, inputHeight / originalHeight);
  const padX = (inputWidth - originalWidth * scale) / 2, padY = (inputHeight - originalHeight * scale) / 2;
  const values = output.data as Float32Array, count = Number(output.dims[1]);
  const detections: Detection[] = [];
  for (let index = 0; index < count; index++) {
    const offset = index * 6, score = values[offset + 4], classId = Math.round(values[offset + 5]);
    const className = metadata!.classes[classId];
    if (score < confidence || !VEHICLE_CLASSES.has(className)) continue;
    const x1 = Math.max(0, (values[offset] - padX) / scale), y1 = Math.max(0, (values[offset + 1] - padY) / scale);
    const x2 = Math.min(originalWidth, (values[offset + 2] - padX) / scale), y2 = Math.min(originalHeight, (values[offset + 3] - padY) / scale);
    if (x2 > x1 && y2 > y1) detections.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, confidence: score, class: className });
  }
  return nms(detections, metadata!.nmsThreshold);
}

self.onmessage = async (event: MessageEvent) => {
  const { id, type } = event.data;
  try {
    if (type === 'init') {
      ort.env.wasm.wasmPaths = `${event.data.basePath}ort-wasm/`;
      console.log('[ort-wasm-debug] wasmPaths set to', ort.env.wasm.wasmPaths, 'basePath', event.data.basePath);
      const metadataResponse = await fetch(`${event.data.basePath}models/model-metadata.json`, { cache: 'no-cache' });
      metadata = await metadataResponse.json() as ModelMetadata;
      const modelUrl = `${event.data.basePath}models/yolov12n.onnx`;
      const cache = await caches.open('crossflow-approved-models-v1');
      let modelResponse = await cache.match(modelUrl);
      const fetchedFromNetwork = !modelResponse;
      if (!modelResponse) modelResponse = await fetch(modelUrl, { cache: 'no-store' });
      if (!modelResponse.ok) throw new Error('Approved model download failed');
      const model = await modelResponse.clone().arrayBuffer();
      const actualHash = hex(await crypto.subtle.digest('SHA-256', model));
      if (actualHash !== event.data.expectedHash || actualHash !== metadata.sha256) throw new Error('Model hash verification failed');
      // Unverified bytes never enter the durable browser cache.
      // The model is already verified and loaded into memory above, so a
      // Cache.put failure (e.g. opaque/non-cacheable response in dev) must
      // not abort initialization.
      if (fetchedFromNetwork) {
        try { await cache.put(modelUrl, modelResponse); }
        catch { /* non-fatal: inference proceeds from the in-memory model */ }
      }
      let failure: unknown;
      let selectedProvider: 'webgpu' | 'wasm' | undefined;
      for (const provider of ['webgpu', 'wasm'] as const) {
        try { session = await ort.InferenceSession.create(model, { executionProviders: [provider], graphOptimizationLevel: 'all', logSeverityLevel: 3 }); selectedProvider = provider; break; }
        catch (error) { failure = error; }
      }
      if (!session) throw failure instanceof Error ? failure : new Error('No supported inference provider');
      metadata = { ...metadata, executionProvider: selectedProvider };
      self.postMessage({ id, type: 'ready', metadata });
    } else if (type === 'detect') {
      if (!session || !metadata) throw new Error('Worker is not initialized');
      const started = performance.now();
      const input = preprocess(event.data.bitmap);
      const preprocessed = performance.now();
      const output = (await session.run({ [session.inputNames[0]]: input }))[session.outputNames[0]] as ort.Tensor;
      const inferred = performance.now();
      const detections = postprocess(output, event.data.width, event.data.height, event.data.minConfidence ?? metadata.confidenceThreshold);
      const completed = performance.now();
      self.postMessage({ id, type: 'result', detections, performance: { preprocessMs: preprocessed - started, inferenceMs: inferred - preprocessed, postprocessMs: completed - inferred, totalMs: completed - started, provider: metadata.executionProvider, inputSize: metadata.inputSize } });
    }
  } catch (error) { self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'Inference failed' }); }
};
