// Shared staging UI; every Finance write is intercepted and uses private fixtures.
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
const errors = [], writes = [], checks = [], missing = [];
let role = 'direct', limited = false, failOnce = false, acknowledge = false, saved = null;
const employee = { id: 'fixture-employee', name: 'Employee reimbursement payee', type: 'EMPLOYEE', active: true };
const dialog = () => page.getByRole('dialog');
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((value) => localStorage.setItem('threejmain_token', value), token);
await page.route('**/api/finance/**', async (route) => {
  const req = route.request(), resource = new URL(req.url()).pathname.replace('/api/finance/', '');
  if (req.method() !== 'GET') {
    const write = { path: resource, body: JSON.parse(req.postData() || '{}'), key: req.headers()['idempotency-key'] };
    writes.push(write);
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Recording confirmation interrupted.' }) }); return;
    }
    if (acknowledge && resource === 'expenses') {
      const p = write.body, paid = Boolean(p.paidDetails);
      saved = { ...p, id: 'fixture-direct-expense', entity: 'PAYABLE', number: 999,
        payeeSnapshot: { id: null, name: 'Payee not specified', type: 'UNSPECIFIED' },
        categorySnapshot: fixtures.categories.find((c) => c.id === p.categoryId), documentReferenceKind: 'INTERNAL',
        version: 2, approvalStatus: 'NOT_REQUIRED', postingStatus: 'POSTED', settlementStatus: paid ? 'PAID' : 'UNPAID',
        paidAmount: paid ? p.amount : '0.00', outstandingAmount: paid ? '0.00' : p.amount,
        createdBy: fixtures.meta.actorUsername, editedBy: fixtures.meta.actorUsername, authorizedBy: fixtures.meta.actorUsername,
        approvedBy: null, nextDueDate: null, purpose: p.purpose,
        payments: paid ? [{ ...p.paidDetails, id: 'fixture-payment', amount: p.amount, createdBy: fixtures.meta.actorUsername,
          accountSnapshot: fixtures.accounts.find((a) => a.id === p.paidDetails.accountId) }] : [],
        approvalHistory: [{ id: 'fixture-decision', action: 'DIRECT_RECORD', version: 2, actor: fixtures.meta.actorUsername, reason: 'Recorded own business expense' }] };
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(saved) }); return;
    }
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Private fixture: write intercepted.' }) }); return;
  }
  let data = fixtures[resource];
  if (resource === 'meta') data = { ...data, approvalLimit: limited ? '100.00' : null,
    permissionsGranted: [...new Set([...data.permissionsGranted, 'finance.expenses.record-direct'])].filter((p) =>
      (role !== 'staff' || p !== 'finance.expenses.record-direct') && (role !== 'no-pay' || p !== 'finance.expenses.pay')) };
  if (resource === 'payees') data = [...data, employee];
  if (resource === 'payables' && saved) data = [...data, saved];
  if (resource === 'payables/fixture-direct-expense') data = saved;
  if (resource === 'payables/fixture-direct-expense/attachments') data = [];
  if (data === undefined) missing.push(resource);
  await route.fulfill({ status: data === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(data ?? { detail: 'Missing fixture' }) });
});
async function open() {
  await page.goto(base + '/finance/expenses');
  await page.getByText('Loading expense records…').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await dialog().getByLabel('Category').selectOption(fixtures.categories.find((c) => c.classification === 'OPERATING_EXPENSE').id);
  await dialog().getByLabel('Amount (PHP)', { exact: true }).fill('100.00');
  await dialog().getByLabel('Description / purpose').fill('Vehicle fuel');
  await dialog().getByLabel('Payee').selectOption(fixtures.payees.find((p) => p.type !== 'EMPLOYEE').id);
}
async function send(name) {
  await dialog().getByRole('button', { name, exact: true }).click();
  await page.getByText('Private fixture: write intercepted.').first().waitFor();
}
try {
  await open();
  assert.equal(await dialog().getByRole('button', { name: 'Save & record', exact: true }).count(), 1);
  await send('Save & record');
  assert.equal(writes.at(-1).body.recordImmediately, true);assert.equal(writes.at(-1).body.submitForApproval, false);
  assert.equal(writes.at(-1).body.paymentArrangement, 'PAY_LATER');
  checks.push('authorized own expense records directly while pay-later remains unpaid');

  await dialog().getByLabel('Employee reimbursement', { exact: true }).check();
  assert.equal(await dialog().getByRole('button', { name: 'Save & record', exact: true }).count(), 0);
  await dialog().getByLabel('Payee').selectOption(employee.id);
  await send('Submit for approval');
  assert.equal(writes.at(-1).body.isReimbursement, true);assert.equal(writes.at(-1).body.recordImmediately, false);
  checks.push('employee reimbursement switches to independent approval and identifies the employee');

  limited = true; await open();
  assert.equal(await dialog().getByRole('button', { name: 'Save & record', exact: true }).count(), 1);
  await dialog().getByLabel('Amount (PHP)', { exact: true }).fill('100.01');
  await send('Submit for approval');
  assert.equal(writes.at(-1).body.submitForApproval, true);
  checks.push('role amount limit switches the action above the exact cent boundary');

  role = 'staff'; limited = false; await open();
  assert.equal(await dialog().getByRole('button', { name: 'Save & record', exact: true }).count(), 0);
  await send('Submit for approval');
  assert.equal(writes.at(-1).body.recordImmediately, false);
  checks.push('staff remains on the submission workflow');

  role = 'no-pay'; await open();
  await dialog().getByLabel('Payment arrangement').selectOption('PAID_NOW');
  assert.equal(await dialog().getByRole('button', { name: 'Save & record', exact: true }).count(), 0);
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('posting authority does not imply payment authority');

  role = 'direct'; await open();
  await dialog().getByLabel('Payment arrangement').selectOption('CHARGED_TO_CARD');
  await dialog().getByLabel('Credit-card account').selectOption(fixtures.workflow.cardId);
  await dialog().getByLabel('Card charge reference').fill('Verified charge');
  await send('Save & record');
  assert.equal(writes.at(-1).body.paidDetails.method, 'CREDIT_CARD');
  assert.equal(writes.at(-1).body.recordImmediately, true);
  checks.push('card charge explicitly explains and records card debt');

  await dialog().getByLabel('Payment arrangement').selectOption('PAID_NOW');
  await dialog().getByLabel('Payee (optional)').selectOption('');
  await dialog().getByLabel('Paid from account').selectOption(fixtures.workflow.fundsId);
  await dialog().getByLabel('Receipt or invoice').setInputFiles({ name: 'fuel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nVerified fuel') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (shots) await page.screenshot({ path: shots + '/direct-expense-mobile.png', fullPage: true });
  failOnce = true; acknowledge = true;
  await dialog().getByRole('button', { name: 'Save & record', exact: true }).click();
  await page.getByText('Recording confirmation interrupted.').first().waitFor();
  const uncertain = writes.at(-1);
  assert.equal(await dialog().getByLabel('Amount (PHP)', { exact: true }).isDisabled(), true);
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /Confirm saved request/ }).click();
  await page.getByText('Saved request confirmed.').waitFor();
  assert.equal(writes.at(-1).key, uncertain.key);assert.deepEqual(writes.at(-1).body, uncertain.body);
  await page.locator('.finance-expenses tbody tr').filter({ hasText: '#999' }).getByRole('button').click();
  await page.getByText('Not required · recorded by ' + fixtures.meta.actorUsername).waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
  assert.equal(await page.locator('.finance-expenses tbody tr').filter({ hasText: '#999' }).getByText('Paid', { exact: true }).count(), 1);
  checks.push('uncertain direct recording freezes inputs and recovers the original request once; attribution and paid status remain clear on mobile');
  assert.deepEqual(errors, []);assert.deepEqual(missing, []);
  console.log(JSON.stringify({ passed: checks.length, checks, interceptedWrites: writes.length }));
} finally { await browser.close(); }
