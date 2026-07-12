export const PLATFORM_ADMIN_ADDRESS = '0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e' as const;

export interface DetectionZone {
  roomId: string;
  roomKey: `0x${string}`;
  topLeftXBps: number;
  topLeftYBps: number;
  topRightXBps: number;
  topRightYBps: number;
  bottomRightXBps: number;
  bottomRightYBps: number;
  bottomLeftXBps: number;
  bottomLeftYBps: number;
  version: number;
  configHash: `0x${string}`;
  updatedAt: number;
  updatedBy: string;
}

export type DetectionZoneDraft = Pick<
  DetectionZone,
  'topLeftXBps' | 'topLeftYBps' | 'topRightXBps' | 'topRightYBps' |
  'bottomRightXBps' | 'bottomRightYBps' | 'bottomLeftXBps' | 'bottomLeftYBps'
>;

export function isPlatformAdmin(address?: string): boolean {
  return address?.toLowerCase() === PLATFORM_ADMIN_ADDRESS.toLowerCase();
}

export function zonePercent(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}
