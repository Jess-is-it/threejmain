// Exercises deployed shared navigation with isolated real-API fixture responses.
// All Finance writes are rejected; no shared financial records are created.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.FINANCE_PLAYWRIGHT_MODULE).href);
const fixtures = JSON.parse(fs.readFileSync(process.env.FINANCE_ACTIVITY_FIXTURES, 'utf8'));
const token = fs.readFileSync(process.env.FINANCE_STAGING_TOKEN_FILE, 'utf8').trim();
const base = process.env.FINANCE_STAGING_URL || 'http://192.168.50.70:8280';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [], missing = [], checks = [];
const screenshots = process.env.FINANCE_STAGING_SCREENSHOTS;
let deny = false, fail = false;
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
await page.route('**/api/finance/**', async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/finance/', '');
  if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 403, json: { detail: 'Read-only fixture' } }); }
  if (deny && path === 'meta') return route.fulfill({ json: { ...fixtures.responses.meta, permissionsGranted: ['finance.view'] } });
  if (fail && path === 'activity') return route.fulfill({ status: 503, json: { detail: 'Transaction history temporarily unavailable' } });
  let body = fixtures.responses[path];
  if (path === 'activity') {
    const pairs = [...url.searchParams].filter(([key, value]) => !(key === 'throughDate' && value !== '2026-01-05') && !(key === 'offset' && value === '0') && !(key === 'limit' && value === '25')).sort(([a], [b]) => a.localeCompare(b));
    body = fixtures.activity[new URLSearchParams(pairs).toString()];
  }
  if (body === undefined) { missing.push(path + '?' + url.searchParams); return route.fulfill({ status: 404, json: { detail: 'Missing fixture' } }); }
  return route.fulfill({ json: body });
});
async function ready() {
  await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
  await page.getByText('Loading transaction history…', { exact: true }).waitFor({ state: 'hidden' });
}
async function filterAction(name) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/finance/activity');
  await page.getByRole('button', { name, exact: true }).click();
  await response; await ready();
  await page.waitForFunction(() => [...document.querySelectorAll('.finance-activity button')].some((b) => b.textContent === 'Refresh activity' && !b.disabled));
}
async function clear() { await filterAction('Clear filters'); }
async function apply() { await filterAction('Apply filters'); }
try {
  await page.goto(base + '/finance/activity'); await ready();
  assert.equal(await page.getByRole('navigation', { name: 'Finance workspaces' }).count(), 0);
  await page.getByLabel('Activity type').selectOption('TRANSFER'); await page.getByLabel('Rows', { exact: true }).selectOption('10'); await apply();
  assert.equal(await page.locator('.finance-activity tbody tr').count(), 10);
  await filterAction('Next');
  assert.match(await page.getByLabel('Activity pagination').innerText(), /11–20 of 30 transactions/);
  await filterAction('Previous');
  checks.push('server pagination and transfers shown once');
  await page.getByRole('button', { name: 'Transfer returned to office', exact: true }).click();
  await page.getByText('Loading supporting record…').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'View original transaction', exact: true }).click();
  await page.getByText('Loading supporting record…').waitFor({ state: 'hidden' });
  await page.getByRole('dialog').getByText('Corrected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close transaction', exact: true }).click();
  checks.push('correction opens retained original evidence');
  await clear(); await page.getByLabel('Search transactions').fill('Owner funding'); await apply();
  assert.equal(await page.locator('.finance-activity tbody tr').count(), 1);
  assert.match(await page.locator('.finance-activity tbody').innerText(), /Owner funding/);
  await clear(); await page.getByLabel('Account', { exact: true }).selectOption(fixtures.walletId); await apply();
  assert.equal(await page.locator('.finance-activity tbody').getByText('Subscriber payment + advance', { exact: true }).count(), 0);
  checks.push('search funding classification and account filter');
  await clear(); await page.getByLabel('From date', { exact: true }).fill('2026-01-05'); await page.getByLabel('Through date', { exact: true }).fill('2026-01-05'); await apply();
  assert.equal(await page.locator('.finance-activity tbody tr').count(), 2);
  const supplier = page.locator('.finance-activity tbody tr').filter({ hasText: 'Supplier payment' });
  await supplier.getByRole('button').click(); await page.getByText('Loading supporting record…').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open expense / payable', exact: true }).click();
  await page.getByRole('heading', { name: /Expense #/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/finance/expenses');
  checks.push('date filter and supplier payment opens exact payable');
  await page.locator('.navbar-vertical .nav-submenu').getByRole('button', { name: 'Activity', exact: true }).click(); await ready();
  await page.getByLabel('Activity type').selectOption('CARD_PURCHASE'); await apply();
  assert.match(await page.locator('.finance-activity tbody').innerText(), /Credit-card purchase/);
  await page.locator('.finance-activity tbody button').click(); await page.getByText('Loading supporting record…').waitFor({ state: 'hidden' });
  await page.getByText('This changes credit-card debt. It does not move company cash.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close transaction', exact: true }).click();
  checks.push('card purchases distinguish debt from cash');
  await clear(); await page.getByLabel('Activity type').selectOption('CORRECTION'); await apply();
  assert.match(await page.locator('.finance-activity tbody').innerText(), /no money moved/);
  await page.locator('.finance-activity tbody button').click(); await page.getByText('Loading supporting record…').waitFor({ state: 'hidden' });
  await page.getByText('No money moved. This corrects a duplicate recorded receipt and retains both accounting records.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close transaction', exact: true }).click();
  checks.push('duplicate correction is separate from an actual refund');
  await clear(); await page.getByLabel('Search transactions').fill('nonexistent'); await apply();
  await page.getByText(/No posted transactions match these filters/).waitFor();
  await clear(); fail = true; await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await page.getByText('Transaction history temporarily unavailable', { exact: false }).waitFor();
  fail = false; await page.getByRole('button', { name: 'Retry activity', exact: true }).click(); await ready();
  checks.push('empty state and retry recover without writes');
  if (screenshots) { fs.mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: screenshots + '/activity-records-desktop.png', fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (screenshots) {
    await page.locator('.finance-activity tbody tr').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshots + '/activity-records-mobile.png', fullPage: false });
  }
  checks.push('mobile layout without page overflow');
  deny = true; await page.reload(); await page.getByText('Your role needs account and journal viewing access to see transaction history.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Search transactions').count(), 0);
  checks.push('interface permission gate');
  assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: errors.length, financialWrites: writes.length }));
} finally { await browser.close(); }
