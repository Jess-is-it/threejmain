// Shared staging UI with isolated API fixtures. All Finance writes are intercepted.
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
const errors = [], writes = [], missing = [], checks = [], created = [];
let permission = true, accountAccess = true, failure = null, soleAccount = false;
const ledgerAccounts = fixtures.accounts.filter((a) => a.kind === 'GENERAL_LEDGER' && a.glType === 'EXPENSE' && !a.system && a.active);
const assetAccount = { ...ledgerAccounts[0], id: 'fixture-asset-ledger', glType: 'ASSET', name: 'Equipment purchases' };
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
await page.route('**/api/finance/**', async (route) => {
  const req = route.request(), url = new URL(req.url()), resource = url.pathname.replace('/api/finance/', '');
  if (req.method() !== 'GET') {
    const write = { path: resource, body: JSON.parse(req.postData() || '{}'), key: req.headers()['idempotency-key'] };
    writes.push(write);
    if (resource === 'categories') {
      if (failure) { const status = failure; failure = null; await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: status === 409 ? 'Category rejected for review.' : 'Confirmation interrupted. Retry the saved category.' }) }); return; }
      const result = { ...write.body, id: `inline-${created.length + 1}`, active: true, version: 1, createdBy: fixtures.meta.actorUsername };
      created.push(result);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(result) }); return;
    }
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Isolated review: expense writes intercepted.' }) }); return;
  }
  let data = fixtures[resource];
  if (resource === 'meta') data = { ...data, permissionsGranted: data.permissionsGranted.filter((p) => (permission || p !== 'finance.expenses.manage') && (accountAccess || p !== 'finance.accounts.view')) };
  if (resource === 'categories') data = [...fixtures.categories, ...created];
  if (resource === 'accounts') data = [...fixtures.accounts.filter((a) => !soleAccount || !ledgerAccounts.some((l) => l.id === a.id) || a.id === ledgerAccounts[0].id), assetAccount];
  if (data === undefined) missing.push(resource);
  await route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(data ?? { detail: 'Missing fixture ' + resource }) });
});
const dialog = () => page.getByRole('dialog');
async function openExpenses() {
  await page.goto(base + '/finance/expenses');
  await page.locator('.finance-header').getByRole('heading', { name: 'Expenses & Payables', exact: true }).waitFor();
  await page.getByText('Loading expense records…').waitFor({ state: 'hidden' });
}
async function addExpense() { await page.getByRole('button', { name: 'Add expense', exact: true }).click(); }
async function addCategory() {
  await dialog().getByRole('button', { name: '+ Add category', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add expense category', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await dialog().getByLabel('Category name').evaluate((el) => document.activeElement === el), true);
}
async function cancel() { await dialog().getByRole('button', { name: 'Cancel', exact: true }).click(); }
async function save(name) {
  await dialog().getByLabel('Category name').fill(name);
  await dialog().getByLabel('Recognition account').selectOption(ledgerAccounts[0].id);
  await dialog().getByRole('button', { name: 'Save category', exact: true }).click();
}
try {
  permission = false; await openExpenses(); await addExpense();
  assert.equal(await dialog().getByRole('button', { name: '+ Add category', exact: true }).count(), 0); await cancel();
  permission = true; accountAccess = false; await openExpenses(); await addExpense();
  assert.equal(await dialog().getByRole('button', { name: '+ Add category', exact: true }).count(), 0); await cancel();
  accountAccess = true; await openExpenses(); await addExpense();
  checks.push('category action requires existing management and account-view grants');

  // Adding a category works before the expense's required fields have been filled.
  await addCategory();
  assert.equal(await dialog().getByLabel('Classification').inputValue(), 'OPERATING_EXPENSE');
  assert.equal(await dialog().getByLabel('Recognition account').inputValue(), '');
  const before = writes.length;
  await dialog().getByRole('button', { name: 'Save category', exact: true }).click(); assert.equal(writes.length, before);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Add expense', exact: true }).waitFor();
  checks.push('single accessible dialog, category validation and Escape return to unsaved expense');

  await dialog().getByLabel('Payee').selectOption(fixtures.payees[0].id);
  await dialog().getByLabel('Category').selectOption(fixtures.categories[0].id);
  await dialog().getByLabel('Amount (PHP)', { exact: true }).fill('100.00');
  await dialog().getByLabel('Description / purpose').fill('Vehicle fuel receipt with installment terms');
  await dialog().getByLabel('Expense date').fill('2026-01-31');
  await dialog().getByLabel('Payment arrangement').selectOption('INSTALLMENTS');
  await dialog().getByLabel('First due date').fill('2026-01-31');
  await dialog().getByRole('button', { name: 'Create monthly schedule' }).click();
  await dialog().getByLabel('Receipt or invoice').setInputFiles({ name: 'fuel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nFuel evidence') });
  await addCategory(); failure = 409; await save('Vehicle Fuel');
  await dialog().getByRole('alert').getByText('Category rejected for review.').waitFor();
  assert.equal(await dialog().getByLabel('Category name').inputValue(), 'Vehicle Fuel');
  await dialog().getByRole('button', { name: 'Save category', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add expense', exact: true }).waitFor();
  assert.equal(await dialog().getByLabel('Category').inputValue(), created.at(-1).id);
  assert.equal(await dialog().getByLabel('Receipt or invoice').evaluate((el) => el.files[0].name), 'fuel.pdf');
  assert.equal(await dialog().getByLabel('Installment 3 amount (PHP)').inputValue(), '33.34');
  assert.equal(await dialog().getByLabel('Description / purpose').inputValue(), 'Vehicle fuel receipt with installment terms');
  await dialog().getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Isolated review: expense writes intercepted.').first().waitFor();
  assert.equal(writes.at(-1).path, 'expenses'); assert.equal(writes.at(-1).body.categoryId, created.at(-1).id);
  assert.equal(writes.at(-1).body.installments.length, 3); assert.match(writes.at(-1).body.attachment.contentBase64, /^JVBER/);
  checks.push('category rejection can be corrected; saved category selected with all expense terms and attachment intact');

  await addCategory(); await dialog().getByLabel('Classification').selectOption('ASSET');
  assert.equal(await dialog().getByLabel('Recognition account').inputValue(), assetAccount.id);
  const options = await dialog().getByLabel('Recognition account').locator('option').evaluateAll((rows) => rows.map((r) => r.value));
  assert.deepEqual(options, ['', assetAccount.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (shots) await page.screenshot({ path: shots + '/inline-category-mobile.png', fullPage: true });
  await cancel(); await cancel();
  checks.push('classification limits matching accounts and category form fits mobile');

  soleAccount = true; await openExpenses(); await addExpense(); await addCategory();
  assert.equal(await dialog().getByLabel('Recognition account').inputValue(), ledgerAccounts[0].id);
  failure = 503; await dialog().getByLabel('Category name').fill('Retry fuel category');
  await dialog().getByRole('button', { name: 'Save category', exact: true }).click();
  await dialog().getByRole('button', { name: 'Confirm saved category', exact: true }).waitFor();
  const uncertain = writes.at(-1);
  assert.equal(await dialog().getByLabel('Category name').isDisabled(), true);
  await dialog().getByRole('button', { name: 'Confirm saved category', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add expense', exact: true }).waitFor();
  assert.equal(writes.at(-1).key, uncertain.key); assert.deepEqual(writes.at(-1).body, uncertain.body);
  assert.equal(await dialog().getByLabel('Category').inputValue(), created.at(-1).id); await cancel();
  checks.push('sole matching account defaults safely and uncertain category request retries its original key and payload');

  const draft = fixtures.payables.find((r) => r.approvalStatus === 'DRAFT' && r.postingStatus === 'UNPOSTED');
  await page.locator('.finance-expenses tbody tr').filter({ hasText: 'Draft' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const originalAmount = await dialog().getByLabel('Amount (PHP)', { exact: true }).inputValue();
  await addCategory(); await save('Draft correction category');
  await page.getByRole('dialog', { name: 'Edit expense draft', exact: true }).waitFor();
  assert.equal(await dialog().getByLabel('Amount (PHP)', { exact: true }).inputValue(), originalAmount);
  const selected = created.at(-1).id;
  await dialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await page.getByText('Isolated review: expense writes intercepted.').first().waitFor();
  assert.equal(writes.at(-1).path, `payables/${draft.id}`); assert.equal(writes.at(-1).body.categoryId, selected); await cancel();
  checks.push('inline category creation also preserves and updates existing expense drafts');

  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: errors.length, interceptedWrites: writes.length, sharedFinancialWrites: 0 }));
} catch (error) { console.error(JSON.stringify({ errors, missing, text: (await page.locator('body').innerText()).slice(-2500), lastWrites: writes.map((r) => r.path) })); throw error; }
finally { await browser.close(); }
