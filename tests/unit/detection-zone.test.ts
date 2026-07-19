import { describe, expect, it } from 'vitest';
import { PLATFORM_ADMIN_ADDRESS, isPlatformAdmin, zonePercent } from '@/config/detection-zone';

describe('detection zone helpers', () => {
  it('matches the immutable platform admin case-insensitively', () => {
    expect(isPlatformAdmin(PLATFORM_ADMIN_ADDRESS.toLowerCase())).toBe(true);
    expect(isPlatformAdmin(PLATFORM_ADMIN_ADDRESS.toUpperCase())).toBe(true);
    expect(isPlatformAdmin('0x0000000000000000000000000000000000000000')).toBe(false);
    expect(isPlatformAdmin()).toBe(false);
  });

  it('formats basis points as percentages', () => {
    expect(zonePercent(2_500)).toBe('25');
    expect(zonePercent(2_550)).toBe('25.5');
  });
});
