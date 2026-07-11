import type { ModelMetadata } from './types';
import { AUTH_API_URL } from './wagmi';

export async function publishInferenceManifest(roomId: string, leaseToken: string, startedAt: Date, finalVehicleCount: number, metadata: ModelMetadata): Promise<{ id: string; sha256: string }> {
  if (!metadata.sha256 || !metadata.executionProvider) throw new Error('Unverified inference runtime');
  const manifest = {
    version: 1, purpose: 'crossflow-market-resolution', roomId,
    startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), finalVehicleCount,
    model: { name: 'yolov12n', sha256: metadata.sha256, inputSize: metadata.inputSize, executionProvider: metadata.executionProvider },
  } as const;
  const response = await fetch(`${AUTH_API_URL}/inference/manifests`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-room-lease': leaseToken }, body: JSON.stringify(manifest),
  });
  if (!response.ok) throw new Error('Manifest publication requires an authenticated wallet session');
  return response.json() as Promise<{ id: string; sha256: string }>;
}
