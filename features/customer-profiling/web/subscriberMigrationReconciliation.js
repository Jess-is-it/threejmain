const amount = (value) => Number(value || 0);
const sameAmount = (left, right) => Math.abs(amount(left) - amount(right)) < 0.01;

export function reconcileSubscriberMigration(batch, serviceAccounts = [], billingRecords = {}, currentCustomers = []) {
  const accounts = new Map(serviceAccounts.map((row) => [row.id, row]));
  const customers = new Map(currentCustomers.map((row) => [row.id, row]));
  const subscriptions = new Map((billingRecords.subscriptions || []).map((row) => [row.id, row]));
  const summaries = new Map((billingRecords.summaries || []).map((row) => [row.serviceAccountId, row]));
  const invoices = billingRecords.invoices || [];
  const evidence = billingRecords.legacyPaymentEvidence || [];
  const rows = (batch?.rows || []).filter((row) => row.status === 'IMPORTED').map((row) => {
    const source = row.raw || row.normalized || {};
    const normalized = row.normalized || {};
    const result = row.result || {};
    const preview = row.billingPreview || {};
    const account = accounts.get(result.serviceAccountId);
    const customer = customers.get(result.customerId);
    const subscription = subscriptions.get(result.subscriptionId);
    const summary = summaries.get(result.serviceAccountId);
    const accountInvoices = invoices.filter((invoice) => invoice.serviceAccountId === result.serviceAccountId);
    const accountEvidence = evidence.filter((item) => item.serviceAccountId === result.serviceAccountId);
    const issues = [];

    if (!result.customerId || !result.serviceAccountId || !result.subscriptionId) {
      issues.push('Import result is missing a Customer, Service, or Billing record ID.');
    }
    if (!account) {
      issues.push('Service account was not found in the current Service records.');
    } else {
      if (account.customerId !== result.customerId) issues.push('Service account is linked to a different customer.');
      if (String(account.status || '').toUpperCase() !== String(normalized.serviceStatus || '').toUpperCase()) {
        issues.push('Service status differs from the imported status.');
      }
      if (!sameAmount(account.monthlyRecurringCharge, normalized.monthlyRate)) {
        issues.push('Service monthly rate differs from the imported rate.');
      }
    }
    if (!customer) issues.push('Current Customer Profile was not found.');
    if (!subscription) {
      issues.push('Billing subscription was not found.');
    } else {
      if (subscription.customerId !== result.customerId || subscription.serviceAccountId !== result.serviceAccountId) {
        issues.push('Billing subscription is linked to a different customer or service account.');
      }
      if (String(subscription.billingMode || '').toUpperCase() !== String(normalized.billingMode || '').toUpperCase()) {
        issues.push('Billing mode differs from the imported mode.');
      }
      if (!sameAmount(subscription.monthlyRate, normalized.monthlyRate)) {
        issues.push('Billing monthly rate differs from the imported rate.');
      }
    }
    if (!summary) issues.push('Current Billing summary was not found.');

    const importedInvoiceNumbers = result.invoiceNumbers || [];
    for (const invoiceNumber of importedInvoiceNumbers) {
      if (!accountInvoices.some((invoice) => invoice.invoiceNumber === invoiceNumber)) {
        issues.push(`Imported invoice ${invoiceNumber} was not found.`);
      }
    }
    const cycleKeys = new Set();
    for (const invoice of accountInvoices.filter((item) => item.status !== 'VOID' && item.billingCycleStart)) {
      const key = `${invoice.subscriptionId}:${invoice.billingCycleStart}`;
      if (cycleKeys.has(key)) issues.push(`More than one invoice exists for the ${invoice.billingCycleStart} cycle.`);
      cycleKeys.add(key);
    }
    if (amount(normalized.lastPaymentAmount) > 0 && !accountEvidence.some((item) => (
      sameAmount(item.amount, normalized.lastPaymentAmount)
      && item.paymentDate === normalized.lastPaymentDate
      && item.paidThroughMonth === normalized.lastPaidThroughMonth
      && item.status === 'REFERENCE_ONLY'
    ))) {
      issues.push('Legacy payment evidence does not match the imported payment and coverage.');
    }
    if (Math.abs(amount(preview.balanceVariance)) >= 0.01) {
      issues.push(`Source balance ${amount(normalized.outstandingBalance).toFixed(2)} differs from reconstructed arrears ${amount(preview.calculatedBalance).toFixed(2)}; imported using ${String(result.balanceResolution || preview.defaultResolution || 'UNSPECIFIED').replaceAll('_', ' ').toLowerCase()}.`);
    }
    if (summary && !sameAmount(summary.balance, accountInvoices
      .filter((invoice) => invoice.status !== 'VOID')
      .reduce((total, invoice) => total + amount(invoice.balance), 0))) {
      issues.push('Current Billing summary does not match open invoice balances.');
    }

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      name: [normalized.firstName, normalized.middleName, normalized.lastName].filter(Boolean).join(' '),
      accountNumber: result.accountNumber || '',
      serviceAccountNumber: result.serviceAccountNumber || '',
      sourceBalance: amount(normalized.outstandingBalance),
      sourceBalanceAsOf: normalized.balanceAsOfDate || batch.cutoverDate || '',
      paidThroughMonth: summary?.paidThroughMonth || normalized.lastPaidThroughMonth || '',
      currentBalance: summary?.balance ?? null,
      nextInvoiceDueDate: summary?.nextDueInvoice?.dueDate || '',
      nextInvoiceCycleStart: summary?.nextInvoiceCycleStart || '',
      customerStatus: customer?.status || '',
      issues
    };
  });
  return {
    batchId: batch?.id || '',
    checkedAt: new Date().toISOString(),
    checked: rows.length,
    verified: rows.filter((row) => row.issues.length === 0).length,
    needsReview: rows.filter((row) => row.issues.length > 0).length,
    rows
  };
}
