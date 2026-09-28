import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const receiptModuleSource = await readFile(
  new URL('../receiptDocument.js', import.meta.url),
  'utf8'
);
const { billingMonthLabel, receiptDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(receiptModuleSource).toString('base64')}`
);

const collection = {
  receiptNumber: 'OR-2026-000123',
  createdAt: '2026-12-15T08:30:00Z',
  customer: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    accountNumber: 'ACC-0001',
    address: 'Zone 2, Roma Norte, Enrile, Cagayan'
  },
  method: 'CASH',
  collectorName: 'Juan Collector',
  amountDueBefore: 4249,
  amount: 3749,
  receivedAmount: 4000,
  returnedAmount: 251,
  balanceAfter: 500,
  accountCreditAfter: 0,
  outstandingInvoicesBefore: [
    {
      invoiceId: 'invoice-july',
      invoiceNumber: 'INV-202607-000012',
      billingCycleStart: '2026-07-01',
      catalogName: 'Fiber 2499',
      regularAmount: 1000,
      amountDue: 1000,
      balance: 1000
    },
    {
      invoiceId: 'invoice-august',
      invoiceNumber: 'INV-202608-000013',
      billingCycleStart: '2026-08-01',
      catalogName: 'Fiber 2499',
      regularAmount: 2499,
      promotionDiscountAmount: 250,
      amountDue: 2249,
      balance: 2499
    },
    {
      invoiceId: 'invoice-september',
      invoiceNumber: 'INV-202609-000014',
      billingCycleStart: '2026-09-01',
      catalogName: 'Fiber 2499',
      regularAmount: 1000,
      amountDue: 1000,
      balance: 1000
    }
  ],
  allocations: [
    {
      invoiceId: 'invoice-july',
      invoiceNumber: 'INV-202607-000012',
      billingCycleStart: '2026-07-01',
      catalogName: 'Fiber 2499',
      amount: 1000,
      balanceBefore: 1000,
      balanceAfter: 0,
      statusAfter: 'PAID'
    },
    {
      invoiceId: 'invoice-august',
      invoiceNumber: 'INV-202608-000013',
      billingCycleStart: '2026-08-01',
      catalogName: 'Fiber 2499',
      amount: 2249,
      balanceBefore: 2499,
      balanceAfter: 0,
      statusAfter: 'PAID',
      promotionDiscountAmount: 250
    },
    {
      invoiceId: 'invoice-september',
      invoiceNumber: 'INV-202609-000014',
      billingCycleStart: '2026-09-01',
      catalogName: 'Fiber 2499',
      amount: 500,
      balanceBefore: 1000,
      balanceAfter: 500,
      statusAfter: 'PARTIALLY_PAID'
    }
  ],
  outstandingInvoicesAfter: [
    {
      invoiceId: 'invoice-september',
      invoiceNumber: 'INV-202609-000014',
      billingCycleStart: '2026-09-01',
      catalogName: 'Fiber 2499',
      balance: 500
    }
  ]
};

function section(html, heading, nextHeading) {
  const start = html.indexOf(`>${heading}</div>`);
  assert.notEqual(start, -1, `${heading} section should exist`);
  const end = nextHeading ? html.indexOf(`>${nextHeading}</div>`, start) : html.length;
  assert.notEqual(end, -1, `${nextHeading} section should follow ${heading}`);
  return html.slice(start, end);
}

test('billing month uses the stored invoice billing period', () => {
  assert.equal(
    billingMonthLabel({ billingCycleStart: '2026-07-01', issueDate: '2026-12-15' }),
    'July 2026'
  );
});

test('receipt presents billing months, allocations, promotion, and remaining month', () => {
  const html = receiptDocument(collection, { label: 'REPRINT', copyNumber: 2 });

  const customerInformation = section(html, 'CUSTOMER INFORMATION', 'PAYMENT RECEIPT');
  const paymentReceipt = section(html, 'PAYMENT RECEIPT', 'CURRENT / OUTSTANDING BILL');
  const currentBill = section(html, 'CURRENT / OUTSTANDING BILL', 'PAYMENT APPLIED TO');
  const paymentApplied = section(html, 'PAYMENT APPLIED TO', 'REMAINING BALANCE');
  const remainingBalance = section(html, 'REMAINING BALANCE', 'PAYMENT SUMMARY');
  const paymentSummary = section(html, 'PAYMENT SUMMARY', 'PAYMENT DETAILS');
  const paymentDetails = section(html, 'PAYMENT DETAILS');

  assert.match(customerInformation, /Customer: Ada Lovelace/);
  assert.match(customerInformation, /Plan: Fiber 2499/);
  assert.match(customerInformation, /Account Number: ACC-0001/);
  assert.match(paymentReceipt, /Billing Status: PARTIALLY PAID/);
  assert.doesNotMatch(html, /REPRINT COPY/);

  assert.match(currentBill, /<strong class="bill-month">July 2026<\/strong>/);
  assert.match(currentBill, /<strong class="bill-month">August 2026<\/strong>/);
  assert.match(currentBill, /<strong class="bill-month">September 2026<\/strong>/);
  assert.match(currentBill, /TOTAL AMOUNT DUE<\/td><td class="num">P 4,249\.00/);
  assert.match(currentBill, /<span class="invoice-ref">Invoice: INV-202608-000013<\/span>/);

  assert.match(paymentApplied, /July 2026 &ndash; Paid/);
  assert.match(paymentApplied, /August 2026 &ndash; Paid/);
  assert.match(paymentApplied, /September 2026 &ndash; Partial/);
  assert.match(paymentApplied, /Regular amount<\/td><td class="num">P 2,499\.00/);
  assert.match(paymentApplied, /Promo discount<\/td><td class="num">- P 250\.00/);
  assert.match(paymentApplied, /Amount applied<\/td><td class="num">P 2,249\.00/);
  assert.match(paymentApplied, /Remaining for this month<\/td><td class="num">P 500\.00/);

  assert.doesNotMatch(remainingBalance, /July 2026/);
  assert.doesNotMatch(remainingBalance, /August 2026/);
  assert.match(remainingBalance, /September 2026/);
  assert.match(remainingBalance, /TOTAL REMAINING<\/td><td class="num">P 500\.00/);
  assert.match(paymentSummary, /Total Amount Paid<\/strong><\/td><td class="num"><strong>P 3,749\.00/);
  assert.match(paymentSummary, /Available Account Credit<\/td><td class="num">P 0\.00/);
  assert.match(paymentDetails, /Amount Received<\/td><td class="num">P 4,000\.00/);
  assert.match(paymentDetails, /Change<\/td><td class="num">P 251\.00/);

  assert.doesNotMatch(currentBill, /December 2026/);
  assert.ok(html.indexOf('CUSTOMER INFORMATION') < html.indexOf('PAYMENT RECEIPT'));
  assert.ok(html.indexOf('PAYMENT RECEIPT') < html.indexOf('CURRENT / OUTSTANDING BILL'));
  assert.ok(html.indexOf('CURRENT / OUTSTANDING BILL') < html.indexOf('PAYMENT APPLIED TO'));
  assert.ok(html.indexOf('PAYMENT APPLIED TO') < html.indexOf('REMAINING BALANCE'));
  assert.ok(html.indexOf('REMAINING BALANCE') < html.indexOf('PAYMENT SUMMARY'));
  assert.ok(html.indexOf('PAYMENT SUMMARY') < html.indexOf('PAYMENT DETAILS'));
});
