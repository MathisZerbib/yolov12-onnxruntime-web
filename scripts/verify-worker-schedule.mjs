import { pathToFileURL } from 'node:url';

export function assertExpectedCron(payload, expectedCron) {
  const schedules = payload?.result?.schedules;
  if (payload?.success !== true || !Array.isArray(schedules)) {
    throw new Error('Cloudflare returned an invalid Cron Trigger response');
  }
  const configured = schedules.map(schedule => schedule?.cron).filter(value => typeof value === 'string');
  if (!configured.includes(expectedCron)) {
    throw new Error(`Worker Cron Trigger ${JSON.stringify(expectedCron)} is missing; configured: ${configured.join(', ') || 'none'}`);
  }
  return configured;
}

export async function verifyWorkerSchedule({ accountId, apiToken, workerName, expectedCron, fetchImpl = globalThis.fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID');
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/i.test(workerName)) throw new Error('WORKER_NAME is invalid');
  if (!expectedCron) throw new Error('EXPECTED_CRON is required');

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/schedules`;
  const response = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${apiToken}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Cloudflare Cron Trigger check failed with HTTP ${response.status}`);
  return assertExpectedCron(payload, expectedCron);
}

async function main() {
  const workerName = process.env.WORKER_NAME ?? 'crossflow-auth';
  const expectedCron = process.env.EXPECTED_CRON ?? '* * * * *';
  const configured = await verifyWorkerSchedule({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    workerName,
    expectedCron,
  });
  console.log(`Verified ${workerName} Cron Trigger: ${configured.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Worker Cron Trigger verification failed');
    process.exitCode = 1;
  });
}
