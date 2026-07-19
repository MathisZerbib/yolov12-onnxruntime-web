import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('RoomCoordinator', () => {
  it('grants, verifies, reports, and releases a room lease', async () => {
    const room = env.ROOMS.getByName('lease-lifecycle');
    const acquired = await room.acquire('0xoperator', 'token-a');
    expect(acquired.acquired).toBe(true);
    expect(await room.verify('0xoperator', 'token-a')).toBe(true);
    expect(await room.status()).toMatchObject({ occupied: true, operator: '0xoperator' });
    expect(await room.release('0xoperator', 'wrong-token')).toBe(false);
    expect(await room.release('0xoperator', 'token-a')).toBe(true);
    expect(await room.status()).toEqual({ occupied: false });
  });

  it('prevents a second operator from taking an active lease', async () => {
    const room = env.ROOMS.getByName('lease-contention');
    await room.acquire('0xfirst', 'token-a');
    const blocked = await room.acquire('0xsecond', 'token-b');
    expect(blocked).toMatchObject({ acquired: false, operator: '0xfirst' });
  });
});
