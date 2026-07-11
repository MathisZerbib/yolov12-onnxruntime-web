import type { ModelMetadata } from './types';
import { AUTH_API_URL } from './wagmi';
import type { DetectionZone } from '@/config/detection-zone';

export async function publishInferenceManifest(roomId: string, leaseToken: string, startedAt: Date, finalVehicleCount: number, metadata: ModelMetadata, zone: DetectionZone): Promise<{ id: string; sha256: string }> {
  if (!metadata.sha256 || !metadata.executionProvider) throw new Error('Unverified inference runtime');
  const manifest = {
    version: 2, purpose: 'crossflow-market-resolution', roomId,
    startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), finalVehicleCount,
    model: { name: 'yolov12n', sha256: metadata.sha256, inputSize: metadata.inputSize, executionProvider: metadata.executionProvider },
    zone: {
      version: zone.version, roomKey: zone.roomKey, configHash: zone.configHash,
      x1Bps: zone.x1Bps, y1Bps: zone.y1Bps, x2Bps: zone.x2Bps, y2Bps: zone.y2Bps,
      countingLineYBps: zone.countingLineYBps,
    },
  } as const;
  const response = await fetch(`${AUTH_API_URL}/inference/manifests`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-room-lease': leaseToken }, body: JSON.stringify(manifest),
  });
  if (!response.ok) throw new Error('Manifest publication requires an authenticated wallet session');
  return response.json() as Promise<{ id: string; sha256: string }>;
}
