function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// Billing grants payment promotions only when their full discounted payoff is allocated.
// The selected invoice list is ordered by due date, so a partial receipt pays the oldest first.
export function planInvoicePayment(rows, receivedAmount) {
  const selectedRows = [...rows].sort((first, second) => (
    String(first.invoice?.dueDate || '9999-12-31').localeCompare(String(second.invoice?.dueDate || '9999-12-31'))
    || String(first.invoice?.invoiceNumber || '').localeCompare(String(second.invoice?.invoiceNumber || ''))
  ));
  const fullPayoffAmount = money(selectedRows.reduce((total, row) => total + money(row.amountToCollect), 0));
  const received = Math.max(0, money(receivedAmount));
  let available = money(Math.min(received, fullPayoffAmount));
  const allocations = [];

  for (const row of selectedRows) {
    if (available <= 0) break;
    const balance = money(row.currentBalance);
    const payoff = money(row.amountToCollect);
    const promotion = row.promotion && available >= payoff ? row.promotion : null;
    const amount = money(promotion ? payoff : Math.min(available, balance));
    if (amount <= 0) continue;
    const discount = promotion ? money(promotion.amount) : 0;
    allocations.push({
      invoiceId: row.invoice.id,
      invoiceNumber: row.invoice.invoiceNumber,
      dueDate: row.invoice.dueDate,
      billingPeriodLabel: row.invoice.billingPeriodLabel,
      balance,
      amount,
      remainingAfter: money(Math.max(0, balance - amount - discount)),
      promotionIds: promotion?.promotionIds || [],
      promotionCount: promotion?.count || 0,
      promotionAmount: discount,
      promotionLabel: promotion?.label || ''
    });
    available = money(available - amount);
  }

  const appliedAmount = money(allocations.reduce((total, row) => total + row.amount, 0));
  return {
    allocations,
    fullPayoffAmount,
    appliedAmount,
    discountAmount: money(allocations.reduce((total, row) => total + row.promotionAmount, 0)),
    excessAmount: money(Math.max(0, received - fullPayoffAmount)),
    isPartial: received > 0 && received < fullPayoffAmount
  };
}
