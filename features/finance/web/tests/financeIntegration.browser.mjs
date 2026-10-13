// Actual shared staging smoke tests: no interception or financial writes.
// Supply a protected existing-session file, never put credentials in this script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.FINANCE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.FINANCE_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.FINANCE_STAGING_URL || 'http://192.168.50.70:8280';
const token = fs.readFileSync(process.env.FINANCE_STAGING_TOKEN_FILE, 'utf8').trim();
assert(token, 'An existing authorized staging session is required');
const browser = await chromium.launch({ headless: true });
const failures = [], rejected = [], writes = [], checks = [];
const screenshots = process.env.FINANCE_STAGING_SCREENSHOTS;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true, mode: 0o700 });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.on('pageerror', (error) => failures.push(error.message));
page.on('response', (response) => { if (response.url().includes('/api/finance/') && response.status() >= 400) rejected.push(response.status()); });
page.on('request', (request) => { if (request.url().includes('/api/finance/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
async function ready() {
  await page.getByRole('heading', { name: 'Finance Management', exact: true }).waitFor();
  await page.getByText('Loading Finance accounts…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Loading reports and their supporting records…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Loading income records…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Loading expense records…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Loading transaction history…', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.finance-management .alert-danger').count(), 0);
}
async function open(path, workspace) {
  await page.goto(base + path); await ready();
  const nav = page.getByRole('navigation', { name: 'Finance workspaces' });
  assert.equal(await nav.getByRole('button').count(), 7);
  assert.equal(await nav.getByRole('button', { name: workspace, exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(new URL(page.url()).pathname, path);
}
try {
  for (const [path, workspace] of [['/finance','Overview'],['/finance/activity','Activity'],['/finance/accounts','Accounts & Transfers'],
    ['/finance/expenses','Expenses & Payables'],['/finance/income','Income & Collections'],
    ['/finance/reports','Financial Reports'],['/finance/subscribers','Subscriber Growth']]) {
    await open(path, workspace); checks.push('deep link '+path);
  }
  await open('/finance/activity', 'Activity');
  await page.getByLabel('Search transactions').fill('nonexistent activity review');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await ready();
  await page.getByText(/No posted transactions match these filters/).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await ready();
  if (screenshots) await page.screenshot({ path: screenshots+'/activity-desktop.png', fullPage: true });
  checks.push('actual transaction-history filters and empty state without posting');
  await open('/finance/accounts','Accounts & Transfers');
  await page.getByRole('button', { name: 'New account', exact: true }).click();
  await page.getByRole('dialog', { name: 'New financial account' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('navigation', { name: 'Finance workspaces' }).getByRole('button', { name: 'Expenses & Payables', exact: true }).click();
  await ready(); assert.equal(new URL(page.url()).pathname, '/finance/expenses');
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add expense' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('navigation', { name: 'Finance workspaces' }).getByRole('button', { name: 'Income & Collections', exact: true }).click();
  await ready(); assert.equal(new URL(page.url()).pathname, '/finance/income');
  assert.equal(await page.getByRole('button', { name: 'Synchronize source', exact: true }).count(), 4);
  for (const button of await page.getByRole('button', { name: 'Synchronize source', exact: true }).all()) assert(await button.isDisabled());
  await page.getByRole('button', { name: 'Other income & funding', exact: true }).click();
  await page.getByRole('button', { name: 'New other income / funding', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('forms and source-cutover gate without posting');
  await open('/finance/reports','Financial Reports');
  await page.getByRole('region', { name: 'Financial period controls' }).waitFor();
  assert(await page.getByRole('button', { name: 'Prepare month closing', exact: true }).isDisabled());
  await page.getByLabel('Report month').fill('2026-09');
  await page.getByLabel('As-of date').fill('2026-09-30');
  await page.getByRole('button', { name: 'Apply dates & basis', exact: true }).click();
  await ready();
  const prepare = page.getByRole('button', { name: 'Prepare month closing', exact: true });
  await prepare.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Prepare month closing' && !b.disabled));
  await prepare.click();
  assert.equal(await page.getByRole('dialog').getByRole('checkbox').count(), 7);
  if (screenshots) await page.screenshot({ path: screenshots+'/period-prepare-desktop.png', fullPage:true });
  await page.getByRole('button', { name: 'Cancel', exact:true }).click();
  checks.push('period read access, incomplete-month gate and reconciliation checklist without posting');
  if (screenshots) await page.screenshot({ path: screenshots+'/reports-desktop.png', fullPage:true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  assert.match((await download).suggestedFilename(), /finance-profit-and-loss/);
  await page.getByRole('button', { name: 'Printable report', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  checks.push('authorized CSV and printable report');
  await open('/finance/subscribers','Subscriber Growth');
  assert.match(await page.locator('.finance-reports').innerText(), /Unavailable/);
  checks.push('unavailable history is explicit');
  await page.setViewportSize({ width: 390, height: 844 });
  await open('/finance/accounts','Accounts & Transfers');
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(horizontalOverflow, false);
  checks.push('mobile shared gutters and overflow');
  if (screenshots) {
    await page.screenshot({ path: screenshots + '/accounts-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open('/finance','Overview');
    await page.screenshot({ path: screenshots + '/overview-desktop.png', fullPage: true });
  }
  assert.deepEqual(failures, []); assert.deepEqual(rejected, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: failures.length, rejectedFinanceRequests: rejected.length, financialWrites: writes.length }));
} finally { await browser.close(); }
