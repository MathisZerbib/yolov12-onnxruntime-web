export const PLATFORM_ADMIN_ADDRESS = '0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e' as const;

export interface DetectionZone {
  roomId: string;
  roomKey: `0x${string}`;
  x1Bps: number;
  y1Bps: number;
  x2Bps: number;
  y2Bps: number;
  countingLineYBps: number;
  version: number;
  configHash: `0x${string}`;
  updatedAt: number;
  updatedBy: string;
}

export type DetectionZoneDraft = Pick<
  DetectionZone,
  'x1Bps' | 'y1Bps' | 'x2Bps' | 'y2Bps' | 'countingLineYBps'
>;

export function isPlatformAdmin(address?: string): boolean {
  return address?.toLowerCase() === PLATFORM_ADMIN_ADDRESS.toLowerCase();
}

export function zonePercent(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}
