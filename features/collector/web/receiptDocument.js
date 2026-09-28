function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function receiptAmount(value) {
  return Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function billingMonthLabel(invoice = {}) {
  const value = invoice.billingCycleStart || invoice.issueDate || invoice.dueDate;
  if (!value) return 'Billing period';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Billing period';
  return parsed.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

function receiptDateTimeLabel(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function receiptCustomerName(customer = {}) {
  return customer.name
    || [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(' ')
    || 'Unnamed customer';
}

export function receiptDocument(collection) {
  const customer = collection.customer || {};
  const advanceAmount = Number(collection.advanceAmount || 0);
  const address = customer.address
    || [customer.addressLine1, customer.addressLine2, customer.barangay, customer.city, customer.province].filter(Boolean).join(', ');
  const allocations = Array.isArray(collection.allocations) ? collection.allocations : [];
  const hasBeforeSnapshot = Array.isArray(collection.outstandingInvoicesBefore);
  const hasAfterSnapshot = Array.isArray(collection.outstandingInvoicesAfter);
  const billsBefore = hasBeforeSnapshot
    ? collection.outstandingInvoicesBefore
    : allocations.map((allocation) => ({
        ...allocation,
        regularAmount: Number(allocation.balanceBefore || allocation.amount || 0),
        promotionDiscountAmount: Number(allocation.promotionDiscountAmount || 0),
        amountDue: Math.max(
          0,
          Number(allocation.balanceBefore || allocation.amount || 0)
            - Number(allocation.promotionDiscountAmount || 0)
        )
      }));
  const billsAfter = hasAfterSnapshot
    ? collection.outstandingInvoicesAfter
    : allocations
        .filter((allocation) => Number(allocation.balanceAfter || 0) > 0)
        .map((allocation) => ({ ...allocation, balance: Number(allocation.balanceAfter || 0) }));
  const currentBillRows = billsBefore.map((bill) => `
    <tr class="bill-row">
      <td>
        <strong class="bill-month">${escapeHtml(billingMonthLabel(bill))}</strong>
        ${bill.invoiceNumber ? `<br><span class="invoice-ref">Invoice: ${escapeHtml(bill.invoiceNumber)}</span>` : ''}
      </td>
      <td class="num"><strong>P ${receiptAmount(bill.amountDue ?? bill.balance ?? bill.regularAmount)}</strong></td>
    </tr>
  `).join('');
  const currentBillTotal = Number(
    collection.amountDueBefore
      ?? billsBefore.reduce((sum, bill) => sum + Number(bill.amountDue ?? bill.balance ?? bill.regularAmount ?? 0), 0)
  );
  const paymentAppliedRows = allocations.map((allocation) => {
    const promotionDiscount = Number(
      allocation.promotionDiscountAmount
        ?? (allocation.promotions || []).reduce((sum, promotion) => sum + Number(promotion.amount || 0), 0)
    );
    const remainingForMonth = Number(allocation.balanceAfter || 0);
    const paid = remainingForMonth <= 0.005 || String(allocation.statusAfter || '').toUpperCase() === 'PAID';
    const status = paid ? 'Paid' : 'Partial';
    const monthHeading = `
      <strong class="bill-month">${escapeHtml(billingMonthLabel(allocation))} &ndash; ${status}</strong>
      ${allocation.invoiceNumber ? `<br><span class="invoice-ref">Invoice: ${escapeHtml(allocation.invoiceNumber)}</span>` : ''}
    `;
    if (promotionDiscount > 0) {
      return `
        <tr class="allocation-month"><td colspan="2">${monthHeading}</td></tr>
        <tr class="detail-row"><td>Regular amount</td><td class="num">P ${receiptAmount(allocation.balanceBefore)}</td></tr>
        <tr class="detail-row"><td>Promo discount</td><td class="num">- P ${receiptAmount(promotionDiscount)}</td></tr>
        <tr class="detail-row payment-row"><td>Amount applied</td><td class="num">P ${receiptAmount(allocation.amount)}</td></tr>
        ${!paid ? `<tr class="detail-row"><td>Remaining for this month</td><td class="num">P ${receiptAmount(remainingForMonth)}</td></tr>` : ''}
      `;
    }
    return `
      <tr class="allocation-month">
        <td>${monthHeading}</td>
        <td class="num"><strong>P ${receiptAmount(allocation.amount)}</strong></td>
      </tr>
      ${!paid ? `<tr class="detail-row"><td>Remaining for this month</td><td class="num">P ${receiptAmount(remainingForMonth)}</td></tr>` : ''}
    `;
  }).join('');
  const knownRemainingBalance = billsAfter.reduce((sum, bill) => sum + Number(bill.balance ?? bill.amountDue ?? 0), 0);
  const unmatchedLegacyBalance = hasAfterSnapshot
    ? 0
    : Math.max(0, Number(collection.balanceAfter || 0) - knownRemainingBalance);
  const remainingRows = billsAfter.map((bill) => `
    <tr class="bill-row">
      <td>
        <strong class="bill-month">${escapeHtml(billingMonthLabel(bill))}</strong>
        ${bill.invoiceNumber ? `<br><span class="invoice-ref">Invoice: ${escapeHtml(bill.invoiceNumber)}</span>` : ''}
      </td>
      <td class="num"><strong>P ${receiptAmount(bill.balance ?? bill.amountDue)}</strong></td>
    </tr>
  `).join('');
  const legacyRemainingRow = unmatchedLegacyBalance > 0
    ? `<tr><td>Other outstanding balance</td><td class="num">P ${receiptAmount(unmatchedLegacyBalance)}</td></tr>`
    : '';
  const planNames = [...new Set(
    [...billsBefore, ...allocations].map((row) => row.catalogName).filter(Boolean)
  )].join(', ');
  const paymentReference = collection.method === 'GCASH' && collection.referenceNumber
    ? `<tr><td>GCash Reference</td><td class="num">${escapeHtml(collection.referenceNumber)}</td></tr>`
    : '';
  const receivedAmount = Number(collection.receivedAmount ?? collection.tenderedAmount ?? collection.amount ?? 0);
  const returnedAmount = Number(collection.returnedAmount ?? collection.changeAmount ?? 0);
  const billingStatus = Number(collection.balanceAfter || 0) > 0 ? 'PARTIALLY PAID' : 'FULLY PAID';
  const returnLabel = collection.method === 'CASH' ? 'Change' : 'Returned to Customer';
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(collection.receiptNumber || 'Payment Receipt')}</title>
      <style>
        * { box-sizing: border-box; }
        body { color: #000; font-family: Arial, sans-serif; font-size: 11pt; margin: 0 auto; width: 300px; -webkit-font-smoothing: none; }
        .header, .thank-you { text-align: center; }
        .header strong { font-size: 11pt; }
        hr { border: 0; border-top: 1px solid #000; margin: 8px 0; }
        hr.dotted { border-top-style: dotted; margin: 4px 0; }
        .section { margin-top: 8px; }
        .section-title { font-weight: bold; margin-bottom: 4px; }
        .bill-month { font-weight: bold; }
        .invoice-ref { font-size: 7.5pt; font-weight: normal; }
        .allocation-month td { padding-top: 5px; }
        .detail-row td { font-size: 9pt; }
        .payment-row td { font-weight: bold; padding-bottom: 3px; }
        .total-row td { border-top: 1px dotted #000; font-weight: bold; padding-top: 4px; }
        .empty-row td { font-size: 9pt; padding: 3px 0; }
        table { border-collapse: collapse; width: 100%; }
        td { padding: 1px 0; vertical-align: top; }
        td.num { text-align: right; white-space: nowrap; }
        .footer-space { height: 25mm; }
        @page { margin: 4mm; size: 80mm auto; }
        @media print { body { width: 72mm; } }
      </style>
    </head>
    <body>
      <div class="header">
        <strong>3J COMPUTER AND INTERNET</strong><br>
        INSTALLATION SERVICES<br>
        Zone 2, Roma Norte, Enrile Cagayan<br>
        09058234990
      </div>
      <hr>
      <div class="section">
        <div class="section-title">CUSTOMER INFORMATION</div>
        Customer: ${escapeHtml(receiptCustomerName(customer))}<br>
        Address: ${escapeHtml(address || 'N/A')}<br>
        Plan: ${escapeHtml(planNames || 'N/A')}<br>
        Account Number: ${escapeHtml(customer.accountNumber || 'N/A')}
      </div>
      <hr>
      <div class="section">
        <div class="section-title">PAYMENT RECEIPT</div>
        Receipt Number: ${escapeHtml(collection.receiptNumber || '')}<br>
        Date: ${escapeHtml(receiptDateTimeLabel(collection.createdAt))}<br>
        Billing Status: ${billingStatus}
      </div>
      <hr>
      <div class="section">
        <div class="section-title">CURRENT / OUTSTANDING BILL</div>
        <table>
          ${currentBillRows || '<tr class="empty-row"><td colspan="2">No outstanding bills before payment.</td></tr>'}
          <tr class="total-row"><td>TOTAL AMOUNT DUE</td><td class="num">P ${receiptAmount(currentBillTotal)}</td></tr>
        </table>
      </div>
      <hr>
      <div class="section">
        <div class="section-title">PAYMENT APPLIED TO</div>
        <table>${paymentAppliedRows || '<tr class="empty-row"><td colspan="2">No current bill allocation.</td></tr>'}</table>
      </div>
      <hr>
      <div class="section">
        <div class="section-title">REMAINING BALANCE</div>
        <table>
          ${remainingRows}${legacyRemainingRow || (!remainingRows ? '<tr class="empty-row"><td colspan="2">No unpaid billing months.</td></tr>' : '')}
          <tr class="total-row"><td>TOTAL REMAINING</td><td class="num">P ${receiptAmount(collection.balanceAfter)}</td></tr>
        </table>
      </div>
      <hr>
      <div class="section">
        <div class="section-title">PAYMENT SUMMARY</div>
        <table>
          <tr><td><strong>Total Amount Paid</strong></td><td class="num"><strong>P ${receiptAmount(collection.amount)}</strong></td></tr>
          <tr><td>Remaining Balance</td><td class="num">P ${receiptAmount(collection.balanceAfter)}</td></tr>
          <tr><td>Available Account Credit</td><td class="num">P ${receiptAmount(collection.accountCreditAfter)}</td></tr>
          ${advanceAmount > 0 ? `<tr><td>Added as Account Credit</td><td class="num">P ${receiptAmount(advanceAmount)}</td></tr>` : ''}
        </table>
      </div>
      <hr class="dotted">
      <div class="section">
        <div class="section-title">PAYMENT DETAILS</div>
        <table>
          <tr><td>Payment Method</td><td class="num">${escapeHtml(collection.method === 'GCASH' ? 'GCash' : 'Cash')}</td></tr>
          ${paymentReference}
          <tr><td>Amount Received</td><td class="num">P ${receiptAmount(receivedAmount)}</td></tr>
          ${(collection.method === 'CASH' || returnedAmount > 0) ? `<tr><td>${returnLabel}</td><td class="num">P ${receiptAmount(returnedAmount)}</td></tr>` : ''}
          <tr><td>Collector</td><td class="num">${escapeHtml(collection.collectorName || collection.collectorUsername || 'N/A')}</td></tr>
        </table>
      </div>
      <hr class="dotted">
      <div class="thank-you section">Thank you for your payment!</div>
      <div class="footer-space"></div>
      <script>
        window.onload = function () {
          window.setTimeout(function () { window.print(); }, 150);
        };
      </script>
    </body>
  </html>`;
}
