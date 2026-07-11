import { Detection, InferencePerformance, ModelMetadata } from './types';

type WorkerResponse =
  | { id: number; type: 'ready'; metadata: ModelMetadata }
  | { id: number; type: 'result'; detections: Detection[]; performance: InferencePerformance }
  | { id: number; type: 'error'; message: string };

export class ObjectDetector {
  private worker: Worker | null = null;
  private metadata: ModelMetadata | null = null;
  private initialized = false;
  private lastPerformance: InferencePerformance | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const basePath = import.meta.env.BASE_URL || '/';
    const metadataResponse = await fetch(`${basePath}models/model-metadata.json`, { cache: 'no-cache' });
    if (!metadataResponse.ok) throw new Error('Could not load approved model metadata');
    const metadata = await metadataResponse.json() as ModelMetadata;
    if (!metadata.sha256) throw new Error('Approved model metadata has no SHA-256 digest');

    this.worker = new Worker(new URL('../workers/inference.worker.ts', import.meta.url), { type: 'module', name: 'crossflow-inference' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.type === 'error') pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Inference worker crashed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    const response = await this.callWorker({ type: 'init', basePath, expectedHash: metadata.sha256 }) as Extract<WorkerResponse, { type: 'ready' }>;
    this.metadata = response.metadata;
    this.initialized = true;
  }

  async detectObjects(imageData: ImageData, minConfidence?: number): Promise<Detection[]> {
    const bitmap = await createImageBitmap(imageData);
    return this.detectBitmap(bitmap, imageData.width, imageData.height, minConfidence);
  }

  async detectCanvas(source: HTMLCanvasElement, minConfidence?: number): Promise<Detection[]> {
    const bitmap = await createImageBitmap(source);
    return this.detectBitmap(bitmap, source.width, source.height, minConfidence);
  }

  private async detectBitmap(bitmap: ImageBitmap, width: number, height: number, minConfidence?: number): Promise<Detection[]> {
    if (!this.initialized || !this.worker) { bitmap.close(); throw new Error('Detector not initialized'); }
    const response = await this.callWorker({ type: 'detect', bitmap, width, height, minConfidence }, [bitmap]) as Extract<WorkerResponse, { type: 'result' }>;
    this.lastPerformance = response.performance;
    return response.detections;
  }

  private callWorker(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('Inference worker unavailable'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...message, id }, transfer);
    });
  }

  isReady(): boolean { return this.initialized; }
  getMetadata(): ModelMetadata | null { return this.metadata; }
  getLastPerformance(): InferencePerformance | null { return this.lastPerformance; }
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initialized = false;
    for (const pending of this.pending.values()) pending.reject(new Error('Detector disposed'));
    this.pending.clear();
  }
}

let sharedDetector: ObjectDetector | null = null;
let sharedInitPromise: Promise<ObjectDetector> | null = null;
export function getSharedDetector(): Promise<ObjectDetector> {
  if (sharedDetector?.isReady()) return Promise.resolve(sharedDetector);
  if (!sharedInitPromise) {
    const detector = new ObjectDetector();
    sharedInitPromise = detector.initialize().then(() => (sharedDetector = detector)).catch((error) => { sharedInitPromise = null; throw error; });
  }
  return sharedInitPromise;
}
