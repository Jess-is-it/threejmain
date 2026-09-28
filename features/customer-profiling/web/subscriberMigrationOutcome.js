const SKIPPED_STATUSES = new Set(['SKIPPED', 'DUPLICATE_IMPORTED']);

export function summarizeSubscriberMigrationOutcome(batch) {
  if (!batch) return null;

  const rows = Array.isArray(batch.rows) ? batch.rows : [];
  const notImportedRows = rows.filter((row) => row.status !== 'IMPORTED').map((row) => {
    const details = row.normalized || {};
    const status = String(row.status || 'PENDING').toUpperCase();
    const validationErrors = Array.isArray(row.validationErrors) ? row.validationErrors.filter(Boolean) : [];
    const reason = String(row.error || '').trim()
      || validationErrors.map(String).join('; ')
      || (status === 'SKIPPED' ? 'Skipped during review.' : 'This row was not imported. Review the batch before retrying.');

    return {
      id: row.id || row.rowNumber,
      rowNumber: row.rowNumber,
      name: [details.firstName, details.lastName].filter(Boolean).join(' ') || 'Subscriber',
      status,
      reason
    };
  });

  return {
    batchId: batch.id,
    filename: batch.filename,
    total: rows.length,
    imported: rows.length - notImportedRows.length,
    notImported: notImportedRows.length,
    failed: notImportedRows.filter((row) => row.status === 'FAILED').length,
    skipped: notImportedRows.filter((row) => SKIPPED_STATUSES.has(row.status)).length,
    invalid: notImportedRows.filter((row) => row.status === 'INVALID').length,
    pending: notImportedRows.filter((row) => !['FAILED', 'INVALID'].includes(row.status) && !SKIPPED_STATUSES.has(row.status)).length,
    notImportedRows
  };
}
