import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertExpectedCron, verifyWorkerSchedule } from '../../scripts/verify-worker-schedule.mjs';

describe('Worker Cron Trigger verification', () => {
  it('declares the one-minute watchdog in the deployable Wrangler config', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')) as {
      triggers?: { crons?: string[] };
    };
    expect(config.triggers?.crons).toEqual(['* * * * *']);
  });

  it('accepts the required production schedule', () => {
    expect(assertExpectedCron({ success: true, result: { schedules: [{ cron: '* * * * *' }] } }, '* * * * *'))
      .toEqual(['* * * * *']);
  });

  it('rejects a deployment with no matching schedule', () => {
    expect(() => assertExpectedCron({ success: true, result: { schedules: [] } }, '* * * * *'))
      .toThrow(/Cron Trigger.*missing/);
  });

  it('queries the Cloudflare schedule endpoint without exposing the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { schedules: [{ cron: '* * * * *' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(verifyWorkerSchedule({
      accountId: 'a'.repeat(32), apiToken: 'secret-token', workerName: 'crossflow-auth', expectedCron: '* * * * *', fetchImpl,
    })).resolves.toEqual(['* * * * *']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workers/scripts/crossflow-auth/schedules',
      { headers: { authorization: 'Bearer secret-token' } },
    );
  });
});
