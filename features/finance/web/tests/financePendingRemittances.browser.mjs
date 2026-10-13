// Shared staging UI with isolated posted service evidence; all Finance writes blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.FINANCE_PLAYWRIGHT_MODULE).href);
const fixtures = JSON.parse(fs.readFileSync(process.env.FINANCE_UI_FIXTURES, 'utf8'));
const scenario = fixtures.collectorReview;
const token = fs.readFileSync(process.env.FINANCE_STAGING_TOKEN_FILE, 'utf8').trim();
const base = process.env.FINANCE_STAGING_URL || 'http://192.168.50.70:8280';
const shots = process.env.FINANCE_STAGING_SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], missing = [], writes = [], checks = [];
let state = 'before', denied = false, scoped = false, negative = false;
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
await page.route('**/api/finance/**', async (route) => {
  const req = route.request(), resource = new URL(req.url()).pathname.replace('/api/finance/', '');
  if (req.method() !== 'GET') { writes.push(resource); return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Isolated review: financial writes blocked.' }) }); }
  let data = fixtures[resource];
  if (resource === 'meta') data = { ...data, permissionsGranted: denied ? ['finance.view','finance.income.view','finance.income.view_all'] : [...data.permissionsGranted,'collector.finance.view'] };
  if (resource === 'accounts') {
    data = scenario[state].accounts.filter((a) => !scoped || a.id === scenario.custodyId);
    if (negative) data = [...data, { ...data.find((a) => a.id === scenario.custodyId), id: 'review-negative-custody', custodian: 'collector-b', name: 'Review discrepancy', balance: '-25.00' }];
  }
  if (resource === 'integration/status') data = { baselineDate: '2026-01-02', cutoverActive: true, sources: [] };
  if (resource === 'sources' || resource === 'journals') data = scenario[state][resource];
  const match = resource.match(/^accounts\/(.+)\/activity$/);
  if (match) data = scenario[state].activities[match[1]];
  if (data === undefined) missing.push(resource);
  return route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(data ?? { detail: 'Missing fixture ' + resource }) });
});
async function open(path) {
  await page.goto(base + path);
  await page.locator('.finance-header h2').waitFor();
  await page.getByText('Loading Finance accounts…').waitFor({ state: 'hidden' });
  if (path.endsWith('/income')) await page.getByText('Loading income records…').waitFor({ state: 'hidden' });
}
async function pending() {
  await open('/finance/income');
  await page.getByRole('button', { name: 'Pending remittances', exact: true }).click();
  if (denied) await page.getByText('Your role does not grant collector balance access.').waitFor();
  else await page.getByRole('region', { name: 'Pending remittances', exact: true }).waitFor();
  return page.locator('.finance-pending-remittances');
}
try {
  await open('/finance/accounts');
  const summaries = page.locator('.finance-account-summaries');
  assert.equal(await summaries.getByRole('button').count(), 2);
  assert.match(await summaries.getByRole('button', { name: /Company funds/ }).innerText(), /₱0\.00/);
  assert.equal(await page.getByText('With collectors', { exact: true }).count(), 0);
  assert.equal(await page.locator('.finance-account-list tbody tr').filter({ hasText: 'COLLECTOR_CASH' }).count(), 0);
  checks.push('unremitted collections excluded from company accounts and both main summaries');
  await open('/finance/income');
  await page.getByRole('button', { name: /Pending remittances ₱1,000\.00/ }).click();
  let panel = page.locator('.finance-pending-remittances');
  await panel.getByRole('heading', { name: 'Pending remittances', exact: true }).waitFor();
  assert.match(await panel.innerText(), /Pending total ₱1,000\.00/);
  assert.equal(await panel.getByRole('link', { name: 'Open Collector', exact: true }).getAttribute('href'), '/collector');
  await panel.getByRole('button', { name: 'View activity', exact: true }).click();
  await panel.getByRole('heading', { name: 'Transaction history', exact: true }).waitFor();
  assert.match(await panel.locator('.finance-account-history').innerText(), /₱700\.00/);
  assert.match(await panel.locator('.finance-account-history').innerText(), /₱300\.00/);
  await panel.getByRole('button', { name: 'Close activity', exact: true }).click();
  checks.push('income summary opens custody balances, original posted evidence and authorized Collector link');
  state = 'after'; await open('/finance/accounts');
  assert.match(await summaries.getByRole('button', { name: /Company funds/ }).innerText(), /₱700\.00/);
  panel = await pending(); assert.match(await panel.innerText(), /Pending total ₱300\.00/);
  const source = scenario.after.sources.items;
  assert.equal(source.filter((r) => r.kind === 'COLLECTOR_REMITTANCE').length, 1);
  assert.equal(source.find((r) => r.kind === 'COLLECTOR_REMITTANCE').result.collectionAmount, '0.00');
  checks.push('recorded receipt batch handover moves 700 to company, leaves 300 pending, creates no new collection');
  negative = true; panel = await pending();
  assert.match(await panel.innerText(), /Pending total ₱300\.00/);
  await panel.getByText('A custody account has a negative balance.', { exact: false }).waitFor();
  await panel.getByLabel('Search records').fill('collector-b');
  assert.equal(await panel.locator('tbody tr').count(), 1); assert.match(await panel.innerText(), /₱-25\.00/);
  checks.push('negative custody flags review without hiding another collector debt; scoped table search works');
  negative = false; state = 'settled'; panel = await pending();
  assert.match(await panel.innerText(), /Pending total ₱0\.00/);
  await panel.getByText('No pending collector remittances match this view in posted Finance records.').waitFor();
  await panel.getByLabel('Include settled custody accounts').check();
  assert.equal(await panel.locator('tbody tr').count(), 2);
  scoped = true; state = 'after'; panel = await pending();
  assert.equal(await panel.locator('tbody tr').count(), 1); assert.match(await panel.innerText(), /Pending total ₱300\.00/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.finance-management')?.getBoundingClientRect().width >= innerWidth - 50);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (shots) await page.screenshot({ path: shots + '/pending-remittances-mobile.png', fullPage: true });
  checks.push('fully settled empty state, retained settled evidence, permitted scope and mobile layout');
  denied = true; panel = await pending();
  await panel.waitFor({ state: 'hidden' });
  await page.getByText('Your role does not grant collector balance access.').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open Collector', exact: true }).count(), 0);
  checks.push('missing balance permission exposes no amounts or Collector link');
  assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ checks, pageErrors: 0, financialWrites: 0 }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ errors, missing, headings: await page.locator('.finance-management h3').allTextContents() }));
  if (shots) await page.screenshot({ path: shots + '/pending-check-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
