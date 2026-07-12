import type { ModelMetadata } from './types';
import { AUTH_API_URL } from './wagmi';
import type { DetectionZone } from '@/config/detection-zone';

export async function publishInferenceManifest(roomId: string, leaseToken: string, startedAt: Date, finalVehicleCount: number, metadata: ModelMetadata, zone: DetectionZone): Promise<{ id: string; sha256: string }> {
  if (!metadata.sha256 || !metadata.executionProvider) throw new Error('Unverified inference runtime');
  const manifest = {
    version: 3, purpose: 'crossflow-market-resolution', roomId,
    startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), finalVehicleCount,
    model: { name: 'yolov12n', sha256: metadata.sha256, inputSize: metadata.inputSize, executionProvider: metadata.executionProvider },
    zone: {
      version: zone.version, roomKey: zone.roomKey, configHash: zone.configHash,
      topLeftXBps: zone.topLeftXBps, topLeftYBps: zone.topLeftYBps,
      topRightXBps: zone.topRightXBps, topRightYBps: zone.topRightYBps,
      bottomRightXBps: zone.bottomRightXBps, bottomRightYBps: zone.bottomRightYBps,
      bottomLeftXBps: zone.bottomLeftXBps, bottomLeftYBps: zone.bottomLeftYBps,
    },
  } as const;
  const response = await fetch(`${AUTH_API_URL}/inference/manifests`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-room-lease': leaseToken }, body: JSON.stringify(manifest),
  });
  if (!response.ok) throw new Error('Manifest publication requires an authenticated wallet session');
  return response.json() as Promise<{ id: string; sha256: string }>;
}
