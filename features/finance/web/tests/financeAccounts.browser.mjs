// Deployed Finance UI using isolated service fixtures. Every Finance mutation is intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.FINANCE_PLAYWRIGHT_MODULE).href);
const fixtures = JSON.parse(fs.readFileSync(process.env.FINANCE_UI_FIXTURES, 'utf8'));
const token = fs.readFileSync(process.env.FINANCE_STAGING_TOKEN_FILE, 'utf8').trim();
const base = process.env.FINANCE_STAGING_URL || 'http://192.168.50.70:8280';
const shots = process.env.FINANCE_STAGING_SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], missing = [], writes = [], checks = [];
const funds = fixtures.accounts.find((a) => a.id === fixtures.workflow.fundsId);
const card = fixtures.accounts.find((a) => a.id === fixtures.workflow.cardId);
const bank = { ...funds, id: 'review-bank', name: 'Review bank', kind: 'BANK', balance: '0.00' };
let reader = false, journalPoster = false, uncertain = false, created = null;
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
await page.route('**/api/finance/**', async (route) => {
  const req = route.request(), url = new URL(req.url()), resource = url.pathname.replace('/api/finance/', '');
  if (req.method() !== 'GET') {
    const body = JSON.parse(req.postData() || '{}');
    writes.push({ path: resource, body, key: req.headers()['idempotency-key'] });
    if (resource === 'accounts') {
      created = { ...funds, ...body, id: 'review-created-account', balance: '0.00', version: 1 };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
    }
    if (resource === 'transfers' && uncertain) {
      uncertain = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Review uncertain request. Confirm the saved request.' }) });
    }
    if (resource === 'transfers' && writes.filter((w) => w.key === req.headers()['idempotency-key']).length > 1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'confirmed-fixture-transfer', idempotentReplay: true }) });
    }
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Isolated review: financial writes intercepted.' }) });
  }
  let data = fixtures[resource];
  if (resource === 'accounts') data = [...fixtures.accounts, bank, ...(created ? [created] : [])];
  if (resource === 'meta' && journalPoster) data = { ...data, actorUsername: 'journal-poster-review', permissionsGranted: ['finance.view', 'finance.accounts.view', 'finance.journals.post'] };
  if (resource === 'meta' && reader) data = { ...data, actorUsername: 'accounts-read-only-review', permissionsGranted: ['finance.view', 'finance.accounts.view', 'finance.transfers.view'] };
  if (data === undefined) missing.push(resource);
  return route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(data ?? { detail: 'Missing fixture ' + resource }) });
});
const dialog = () => page.getByRole('dialog');
async function cancel() { await dialog().getByRole('button', { name: 'Cancel', exact: true }).click(); }
async function open() {
  await page.goto(base + '/finance/accounts');
  await page.locator('.finance-header').getByRole('heading', { name: 'Accounts & Transfers', exact: true }).waitFor();
  await page.getByText('Loading Finance accounts…').waitFor({ state: 'hidden' });
  await page.locator('.finance-account-list').waitFor();
}
async function group(name) { await page.locator('.finance-account-summaries').getByRole('button', { name: new RegExp(name) }).click(); }
try {
  await open();
  assert.equal(await page.getByRole('navigation', { name: 'Accounting foundation views' }).count(), 0);
  const company = fixtures.accounts.filter((a) => a.active && !a.system && ['CASH', 'PETTY_CASH', 'BANK', 'COMPANY_GCASH'].includes(a.kind));
  const expected = company.reduce((sum, a) => sum + Number(a.balance), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.match(await page.locator('.finance-account-summaries').getByRole('button', { name: /Company funds/ }).innerText(), new RegExp('₱' + expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await group('Credit cards');
  assert.equal(await page.getByRole('region', { name: 'Company funds' }).count(), 0);
  assert.match(await page.getByRole('region', { name: 'Credit cards' }).innerText(), /₱60\.00/);
  assert.match(await page.getByRole('region', { name: 'Credit cards' }).innerText(), /2026-02-15/);
  await page.getByRole('button', { name: 'Show all accounts', exact: true }).click();
  await page.getByLabel('Search records').fill('Petty cash office');
  await page.getByText('1–25 of 26 records').waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('26–26 of 26 records').waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  if (shots) await page.screenshot({ path: shots + '/accounts-desktop.png', fullPage: true });
  checks.push('group totals separate funds/custody/card debt; summaries drill down; search and pagination');

  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  assert.equal(await dialog().getByLabel('Account code').count(), 0);
  assert.equal(await dialog().getByLabel('Notes (optional)').isVisible(), false);
  await dialog().getByLabel('Account name').fill('Review collector account');
  await dialog().getByLabel('Account type').selectOption('COLLECTOR_CASH');
  assert.equal(await dialog().getByLabel('Person responsible', { exact: true }).evaluate((el) => el.required), true);
  const blocked = writes.length;
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
  assert.equal(writes.length, blocked);
  await dialog().getByLabel('Account type').selectOption('CASH');
  await dialog().getByLabel('Account name').fill('Review new cash account');
  await dialog().getByLabel('Set starting balance after creating this account').check();
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Set starting balance', exact: true }).waitFor();
  assert.equal(await dialog().getByLabel('Named account').inputValue(), created.id);
  const accountWrite = writes.at(-1);
  assert.equal(accountWrite.path, 'accounts'); assert.match(accountWrite.body.code, /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
  assert.equal(Object.hasOwn(accountWrite.body, 'setStartingBalance'), false);
  await dialog().getByLabel('Opening balance (amount held or owed)').fill('250.00');
  await dialog().getByLabel('Supporting evidence reference').fill('Reviewed cash-count sheet');
  await dialog().getByLabel('Reason', { exact: true }).fill('Verified starting balance');
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await dialog().getByText('Isolated review: financial writes intercepted.').waitFor();
  assert.equal(writes.at(-1).path, 'opening-balances');
  assert.equal(writes.at(-1).body.accountId, created.id);
  assert.equal(writes.some((w) => w.path.endsWith('/post')), false);
  await cancel(); await page.getByRole('button', { name: 'Back to accounts', exact: true }).click();
  checks.push('simple account form generates code; collector requires responsible person; optional opening stays independently reviewed');

  await page.getByRole('button', { name: 'Transfer money', exact: true }).click();
  await dialog().getByLabel('From account', { exact: true }).selectOption(funds.id);
  assert.equal(await dialog().getByLabel('To account', { exact: true }).locator(`option[value="${funds.id}"]`).count(), 0);
  await dialog().getByLabel('To account', { exact: true }).selectOption(bank.id);
  await dialog().getByLabel('Amount (PHP)', { exact: true }).fill('5.25');
  await dialog().getByLabel('Purpose', { exact: true }).fill('Reviewed bank deposit');
  assert.equal(await dialog().getByLabel('Document reference').count(), 0);
  assert.match(await dialog().innerText(), /Move ₱5\.25 from Named account to Review bank/);
  const beforeReference = writes.length;
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click(); assert.equal(writes.length, beforeReference);
  await dialog().getByLabel('Payment / transfer reference').fill('Review bank reference');
  uncertain = true;
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page.getByText('A Finance request is awaiting confirmation.', { exact: false }).first().waitFor();
  const frozen = writes.at(-1);
  assert.equal(frozen.body.method, 'BANK_TRANSFER'); assert.equal(frozen.body.amount, '5.25'); assert.ok(frozen.body.sourceReference);
  await cancel(); await page.getByRole('button', { name: 'Confirm saved request', exact: true }).click();
  await page.getByText('Saved request confirmed.', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), frozen);
  checks.push('friendly transfer preview, distinct accounts, required reference and frozen request/key recovery');

  await group('Company funds');
  await page.getByLabel('Search records').fill(funds.id);
  await page.getByRole('region', { name: 'Company funds' }).getByRole('button', { name: funds.name, exact: true }).click();
  await page.getByRole('heading', { name: 'Transaction history', exact: true }).waitFor();
  await page.getByRole('columnheader', { name: /^Money in$/i }).waitFor();
  await page.getByRole('columnheader', { name: /^Money out$/i }).waitFor();
  const opening = page.locator('.finance-account-history tbody tr').filter({ hasText: 'Starting balance' });
  assert.equal(await opening.count(), 1); assert.deepEqual(await opening.locator('td').allTextContents().then((r) => r.slice(2, 4)), ['—', '—']);
  assert.equal(await opening.getByText('Debit', { exact: false }).isVisible(), false);
  await opening.locator('summary').click(); assert.equal(await opening.getByText('Debit', { exact: false }).isVisible(), true);
  await page.getByRole('button', { name: 'Back to accounts', exact: true }).click();
  await group('Credit cards');
  await page.getByRole('region', { name: 'Credit cards' }).getByRole('button', { name: card.name, exact: true }).click();
  await page.getByRole('columnheader', { name: /^Charges$/i }).waitFor();
  await page.getByRole('columnheader', { name: /^Repayments$/i }).waitFor();
  await page.getByRole('button', { name: 'Pay credit card', exact: true }).click();
  await page.getByText('Loading card bills…').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.finance-cards tbody tr').count(), 1);
  await page.locator('.finance-cards tbody tr button').first().click();
  await page.getByRole('button', { name: 'Record card repayment', exact: true }).click();
  assert.equal(await dialog().getByLabel('Repayment amount (PHP)').inputValue(), '60.00');
  assert.equal(await dialog().getByLabel('Pay from account').locator(`option[value="${card.id}"]`).count(), 0);
  await cancel();
  checks.push('account history uses cash/card language, excludes baseline from movements, and selected-card repayment follows bill remaining');

  await page.getByRole('button', { name: 'Back to accounts', exact: true }).click();
  await page.locator('.finance-manage summary').focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Starting balances', exact: true }).click();
  await page.getByRole('heading', { name: 'Starting balances', exact: true }).waitFor();
  assert.equal(await page.locator('.finance-manage').getAttribute('open'), null);
  await page.getByRole('button', { name: 'Back to accounts', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.finance-management')?.getBoundingClientRect().width >= innerWidth - 50);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (shots) await page.screenshot({ path: shots + '/accounts-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Transfer money', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (shots) await page.screenshot({ path: shots + '/transfer-mobile.png', fullPage: true });
  await cancel();
  reader = true; await open();
  assert.equal(await page.getByRole('button', { name: 'Add account', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Transfer money', exact: true }).count(), 0);
  assert.equal(await page.locator('.finance-manage').count(), 0);
  checks.push('Manage keyboard navigation, mobile layout and read-only permissions');
  reader = false; journalPoster = true; await open();
  await page.locator('.finance-manage summary').click();
  assert.equal(await page.getByRole('button', { name: 'Journal entries', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Post journal', exact: true }).click();
  await page.getByRole('dialog', { name: 'Post accounting journal', exact: true }).waitFor();
  await cancel();
  checks.push('journal-only posting capability retains its Manage action without granting journal browsing');
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  console.log(JSON.stringify({ checks, browserErrors: errors, actualFinanceWrites: 0, interceptedAttempts: writes.length }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ browserErrors: errors, missingFixtures: missing, headings: await page.locator('.finance-management h3').allTextContents(), headers: await page.locator('.finance-management th').allTextContents() }));
  if (shots) await page.screenshot({ path: shots + '/accounts-check-failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
