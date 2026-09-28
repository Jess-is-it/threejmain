import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeSubscriberMigrationOutcome } from '../subscriberMigrationOutcome.js';

test('subscriber import result counts every row that was not imported and explains why', () => {
  const outcome = summarizeSubscriberMigrationOutcome({
    id: 'batch-1',
    filename: 'subscribers.xlsx',
    rows: [
      { id: 'one', rowNumber: 1, status: 'IMPORTED' },
      { id: 'two', rowNumber: 2, status: 'FAILED', error: 'Billing account could not be created.', normalized: { firstName: 'Ada', lastName: 'Lovelace' } },
      { id: 'three', rowNumber: 3, status: 'INVALID', validationErrors: ['Contact number is required.'] },
      { id: 'four', rowNumber: 4, status: 'SKIPPED' },
      { id: 'five', rowNumber: 5, status: 'DUPLICATE_IMPORTED', error: 'Already imported in another batch.' },
      { id: 'six', rowNumber: 6, status: 'READY' }
    ]
  });

  assert.deepEqual(
    { total: outcome.total, imported: outcome.imported, notImported: outcome.notImported, failed: outcome.failed, invalid: outcome.invalid, skipped: outcome.skipped, pending: outcome.pending },
    { total: 6, imported: 1, notImported: 5, failed: 1, invalid: 1, skipped: 2, pending: 1 }
  );
  assert.equal(outcome.notImportedRows[0].name, 'Ada Lovelace');
  assert.equal(outcome.notImportedRows[0].reason, 'Billing account could not be created.');
  assert.equal(outcome.notImportedRows[1].reason, 'Contact number is required.');
  assert.equal(outcome.notImportedRows[2].reason, 'Skipped during review.');
  assert.equal(outcome.notImportedRows[3].reason, 'Already imported in another batch.');
  assert.match(outcome.notImportedRows[4].reason, /not imported/i);
});

test('a fully imported batch has no rows needing attention', () => {
  const outcome = summarizeSubscriberMigrationOutcome({ rows: [{ id: 'one', status: 'IMPORTED' }] });
  assert.equal(outcome.imported, 1);
  assert.equal(outcome.notImported, 0);
  assert.deepEqual(outcome.notImportedRows, []);
});
