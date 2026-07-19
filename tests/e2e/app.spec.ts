import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const roomKey = `0x${'1'.repeat(64)}`;

async function mockExternalServices(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4173', 'content-type': 'application/json' };

    if (path === '/leaderboard' || path === '/activity') {
      await route.fulfill({ status: 200, headers, body: '[]' });
      return;
    }
    if (path === '/profile' || path === '/auth/session') {
      await route.fulfill({ status: 401, headers, body: JSON.stringify({ authenticated: false }) });
      return;
    }
    if (/^\/rooms\/[a-z0-9-]+\/zone$/.test(path)) {
      const roomId = path.split('/')[2];
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        roomId, roomKey,
        topLeftXBps: 0, topLeftYBps: 2_500,
        topRightXBps: 10_000, topRightYBps: 2_500,
        bottomRightXBps: 10_000, bottomRightYBps: 10_000,
        bottomLeftXBps: 0, bottomLeftYBps: 10_000,
        version: 1, configHash: roomKey, updatedAt: 1, updatedBy: '0x0000000000000000000000000000000000000001',
      }) });
      return;
    }
    if (/^\/rooms\/[a-z0-9-]+\/market$/.test(path)) {
      const roomId = path.split('/')[2];
      const serverTime = Math.floor(Date.now() / 1_000);
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        roomId, roomKey, enabled: true, serverTime, phase: 'open', marketId: '42',
        closeTime: serverTime + 30, resolveDeadline: serverTime + 630,
        lowerBound: 10, upperBound: 30, exactTarget: 20, feeBps: 200,
        totalPoolWei: '0', outcomePoolsWei: ['0', '0', '0', '0'],
        nextRoundExpectedAt: serverTime + 30, staleAfter: serverTime + 10, roundDurationSeconds: 30,
      }) });
      return;
    }
    await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: 'Not found' }) });
  });

  await page.route('**/*.m3u8', route => route.abort());
  await page.route('**/models/yolov12n.onnx', route => route.abort());
  await page.route('https://sepolia-rollup.arbitrum.io/**', route => route.abort());
}

test.beforeEach(async ({ page }) => {
  await mockExternalServices(page);
});

test('builds a position and opens the selected room', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /the street is the oracle/i })).toBeVisible();
  await page.getByRole('button', { name: 'Paris', exact: true }).click();
  await page.getByRole('button', { name: /review position/i }).click();
  await expect(page).toHaveURL(/\/room\/paris$/);
  await expect(page.getByRole('heading', { name: /how many vehicles cross the zone/i })).toBeVisible();
  await expect(page.getByText('ROUND #42')).toBeVisible();
});

const routeCases = [
  ['/', /the street is the oracle/i],
  ['/how-it-works', /from camera frame to final settlement/i],
  ['/activity', /market activity/i],
  ['/leaderboard', /proof operators/i],
  ['/profile', /sign in to view operator history/i],
  ['/admin', /protocol administration/i],
  ['/admin/zones', /detection zone control plane/i],
  ['/admin/contracts', /contract & role wallets/i],
  ['/admin/explorer', /contract explorer/i],
] as const;

for (const [path, heading] of routeCases) {
  test(`renders ${path} without a blank route`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  });
}

test('home has no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious');
  expect(serious, serious.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('home remains within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /the street is the oracle/i })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
