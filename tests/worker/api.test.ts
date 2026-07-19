import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const origin = 'http://localhost:5173';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('origin')) headers.set('origin', origin);
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://worker.test${path}`, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('Worker HTTP API', () => {
  it('returns credentialed CORS headers for an allowed preflight', async () => {
    const response = await request('/auth/nonce', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('rejects cross-origin authentication and invalid wallets', async () => {
    const crossOrigin = await request('/auth/nonce', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chainId: 421614 }),
    });
    expect(crossOrigin.status).toBe(403);

    const invalidWallet = await request('/auth/nonce', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: 'invalid', chainId: 421614 }),
    });
    expect(invalidWallet.status).toBe(400);
    await expect(invalidWallet.json()).resolves.toEqual({ error: 'Invalid wallet or chain' });
  });

  it('issues a single-use SIWE challenge for Arbitrum Sepolia', async () => {
    const response = await request('/auth/nonce', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chainId: 421614 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ message: string; expiresAt: number }>();
    expect(body.message).toContain('Authenticate to Crossflow');
    expect(body.message).toContain('Chain ID: 421614');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1_000));
  });

  it('reports unauthenticated sessions and protects private endpoints', async () => {
    const session = await request('/auth/session');
    expect(session.status).toBe(401);
    await expect(session.json()).resolves.toEqual({ authenticated: false });
    expect((await request('/profile')).status).toBe(401);
    expect((await request('/rooms/tokyo/lease', { method: 'POST' })).status).toBe(401);
    expect((await request('/inference/manifests', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('serves public activity, leaderboard, and configured zones', async () => {
    const leaderboard = await request('/leaderboard');
    expect(leaderboard.status).toBe(200);
    await expect(leaderboard.json()).resolves.toEqual([]);
    await expect((await request('/activity')).json()).resolves.toEqual([]);

    const zone = await request('/rooms/tokyo/zone');
    expect(zone.status).toBe(200);
    await expect(zone.json()).resolves.toMatchObject({
      roomId: 'tokyo', version: 1,
      topLeftXBps: 0, topLeftYBps: 2_500,
      bottomRightXBps: 10_000, bottomRightYBps: 10_000,
    });
    expect((await request('/rooms/unknown/zone')).status).toBe(404);
  });

  it('uses secure response headers and explicit method/not-found errors', async () => {
    const method = await request('/rooms/tokyo/zone', { method: 'PATCH' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, PUT');

    const missing = await request('/missing');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
