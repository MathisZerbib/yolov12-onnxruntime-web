export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

export interface DetectionStats {
  totalDetections: number;
  averageConfidence: number;
  lastDetectionTime: number;
  classCounts: Record<string, number>;
}
export interface InferencePerformance { preprocessMs: number; inferenceMs: number; postprocessMs: number; totalMs: number; provider: 'webgpu' | 'wasm'; inputSize: [number, number]; }

export interface ModelMetadata {
  inputSize: [number, number];
  classes: string[];
  confidenceThreshold: number;
  nmsThreshold: number;
  sha256?: string;
  executionProvider?: 'webgpu' | 'wasm';
}

export interface TrafficstreamSettings {
  minConfidence: number;
  vehicleClasses: string[];
  countingLineY: number;
  roiPts: Array<{ x: number; y: number }>;
  detectionColor: string;
  trackColor: string;
  showLabels: boolean;
  showRoi: boolean;
  showCountingLine: boolean;
}
