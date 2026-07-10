import * as ort from 'onnxruntime-web/webgpu';
import { Detection, ModelMetadata } from './types';

export class ObjectDetector {
  private session: ort.InferenceSession | null = null;
  private metadata: ModelMetadata | null = null;
  private isInitialized = false;
  private preCanvas: HTMLCanvasElement | null = null;
  private preCtx: CanvasRenderingContext2D | null = null;
  private srcCanvas: HTMLCanvasElement | null = null;
  private srcCtx: CanvasRenderingContext2D | null = null;

  async initialize(): Promise<void> {
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
      ort.env.wasm.simd = true;
      ort.env.wasm.proxy = false;

      const basePath = import.meta.env.BASE_URL || '/';
      
      const metadataResponse = await fetch(`${basePath}models/model-metadata.json`);
      this.metadata = await metadataResponse.json();
      
      const executionProviders = [
        ['webgpu'],
      ];

      let lastError: Error | null = null;
      
      for (const providers of executionProviders) {
        try {
          this.session = await ort.InferenceSession.create(`${basePath}models/yolov12n.onnx`, {
            executionProviders: providers,
            graphOptimizationLevel: 'all',
            enableCpuMemArena: true,
            enableMemPattern: true
          });

          this.isInitialized = true;
          return;
        } catch (error) {
          lastError = error as Error;
          continue;
        }
      }

      throw lastError || new Error('All execution providers failed');
      
    } catch (error) {
      console.error('Failed to initialize object detector:', error);
      throw error;
    }
  }

  async detectObjects(imageData: ImageData, minConfidence?: number): Promise<Detection[]> {
    if (!this.session || !this.metadata || !this.isInitialized) {
      throw new Error('Detector not initialized');
    }

    try {
      const input = this.preprocessImage(imageData);
      
      const inputName = this.session.inputNames[0];
      const outputName = this.session.outputNames[0];
      
      const results = await this.session.run({ [inputName]: input });
      const output = results[outputName] as ort.Tensor;

      const threshold = minConfidence ?? this.metadata!.confidenceThreshold;
      const detections = this.postprocessResults(output, imageData.width, imageData.height, threshold);
      
      return detections;
    } catch (error) {
      console.error('Detection failed:', error);
      return [];
    }
  }

  private preprocessImage(imageData: ImageData): ort.Tensor {
    const [inputWidth, inputHeight] = this.metadata!.inputSize;

    if (!this.preCanvas || this.preCanvas.width !== inputWidth || this.preCanvas.height !== inputHeight) {
      this.preCanvas = document.createElement('canvas');
      this.preCtx = this.preCanvas.getContext('2d', { willReadFrequently: true })!;
      this.preCanvas.width = inputWidth;
      this.preCanvas.height = inputHeight;

      this.srcCanvas = document.createElement('canvas');
      this.srcCtx = this.srcCanvas.getContext('2d', { willReadFrequently: true })!;
    }

    if (this.srcCanvas!.width !== imageData.width || this.srcCanvas!.height !== imageData.height) {
      this.srcCanvas!.width = imageData.width;
      this.srcCanvas!.height = imageData.height;
    }

    this.srcCtx!.putImageData(imageData, 0, 0);

    const ctx = this.preCtx!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, inputWidth, inputHeight);

    const aspectRatio = imageData.width / imageData.height;
    const targetAspectRatio = inputWidth / inputHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (aspectRatio > targetAspectRatio) {
      drawWidth = inputWidth;
      drawHeight = inputWidth / aspectRatio;
      offsetX = 0;
      offsetY = (inputHeight - drawHeight) / 2;
    } else {
      drawHeight = inputHeight;
      drawWidth = inputHeight * aspectRatio;
      offsetX = (inputWidth - drawWidth) / 2;
      offsetY = 0;
    }

    ctx.drawImage(this.srcCanvas!, 0, 0, imageData.width, imageData.height, offsetX, offsetY, drawWidth, drawHeight);

    const paddedImageData = ctx.getImageData(0, 0, inputWidth, inputHeight);

    const data = new Float32Array(inputWidth * inputHeight * 3);
    const src = paddedImageData.data;
    const len = src.length;

    for (let i = 0, j = 0; i < len; i += 4, j++) {
      data[j] = src[i] / 255;
      data[j + inputWidth * inputHeight] = src[i + 1] / 255;
      data[j + 2 * inputWidth * inputHeight] = src[i + 2] / 255;
    }

    return new ort.Tensor('float32', data, [1, 3, inputHeight, inputWidth]);
  }

  private applyNMS(detections: Detection[]): Detection[] {
    detections.sort((a, b) => b.confidence - a.confidence);

    const filtered: Detection[] = [];
    const len = detections.length;
    const used = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      if (used[i]) continue;

      const detection = detections[i];
      filtered.push(detection);
      used[i] = 1;

      const x1 = detection.x;
      const y1 = detection.y;
      const x2 = x1 + detection.width;
      const y2 = y1 + detection.height;
      const area = detection.width * detection.height;

      for (let j = i + 1; j < len; j++) {
        if (used[j]) continue;

        const other = detections[j];
        const ix1 = Math.max(x1, other.x);
        const iy1 = Math.max(y1, other.y);
        const ix2 = Math.min(x2, other.x + other.width);
        const iy2 = Math.min(y2, other.y + other.height);

        if (ix2 <= ix1 || iy2 <= iy1) continue;

        const intersection = (ix2 - ix1) * (iy2 - iy1);
        const union = area + other.width * other.height - intersection;

        if (intersection / union > this.metadata!.nmsThreshold) {
          used[j] = 1;
        }
      }
    }

    return filtered;
  }

  private postprocessResults(output: ort.Tensor, originalWidth: number, originalHeight: number, confidenceThreshold: number): Detection[] {
    const [inputWidth, inputHeight] = this.metadata!.inputSize;

    const aspectRatio = originalWidth / originalHeight;
    const targetAspectRatio = inputWidth / inputHeight;

    let paddingX, paddingY, scaleX, scaleY;

    if (aspectRatio > targetAspectRatio) {
      scaleX = originalWidth / inputWidth;
      scaleY = originalWidth / inputWidth;
      paddingX = 0;
      paddingY = (inputHeight - (inputWidth / aspectRatio)) / 2;
    } else {
      scaleX = originalHeight / inputHeight;
      scaleY = originalHeight / inputHeight;
      paddingX = (inputWidth - (inputHeight * aspectRatio)) / 2;
      paddingY = 0;
    }

    const detections: Detection[] = [];
    const outputData = output.data as Float32Array;
    const classes = this.metadata!.classes;
    const numDetections = output.dims[1];

    for (let i = 0; i < numDetections; i++) {
      const startIdx = i * 6;

      const x1 = outputData[startIdx];
      const y1 = outputData[startIdx + 1];
      const x2 = outputData[startIdx + 2];
      const y2 = outputData[startIdx + 3];
      const confidence = outputData[startIdx + 4];
      const classId = Math.round(outputData[startIdx + 5]);

      if (confidence < confidenceThreshold) continue;

      const transformedX1 = (x1 - paddingX) * scaleX;
      const transformedY1 = (y1 - paddingY) * scaleY;
      const transformedX2 = (x2 - paddingX) * scaleX;
      const transformedY2 = (y2 - paddingY) * scaleY;

      const x = Math.max(0, transformedX1);
      const y = Math.max(0, transformedY1);
      const width = Math.max(0, transformedX2 - transformedX1);
      const height = Math.max(0, transformedY2 - transformedY1);

      const className = classes[classId] || `class_${classId}`;

      if (className !== 'car') continue;

      detections.push({
        x,
        y,
        width: Math.min(width, originalWidth - x),
        height: Math.min(height, originalHeight - y),
        confidence,
        class: className
      });
    }

    return this.applyNMS(detections);
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.preCanvas = null;
    this.preCtx = null;
    this.srcCanvas = null;
    this.srcCtx = null;
    this.isInitialized = false;
  }
}

// Shared singleton so we never create two WebGPU inference sessions at the
// same time (onnxruntime-web throws "another WebGPU EP inference session is
// being created" when sessions are created concurrently on one device).
let sharedDetector: ObjectDetector | null = null;
let sharedInitPromise: Promise<ObjectDetector> | null = null;

export function getSharedDetector(): Promise<ObjectDetector> {
  if (sharedDetector && sharedDetector.isReady()) {
    return Promise.resolve(sharedDetector);
  }
  if (!sharedInitPromise) {
    const detector = new ObjectDetector();
    sharedInitPromise = detector
      .initialize()
      .then(() => {
        sharedDetector = detector;
        return detector;
      })
      .catch((err) => {
        sharedInitPromise = null;
        throw err;
      });
  }
  return sharedInitPromise;
}
