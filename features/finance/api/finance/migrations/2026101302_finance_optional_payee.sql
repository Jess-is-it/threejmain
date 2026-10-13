-- Append-only refinement: no rewrite of retained documents or applied migrations.
ALTER TABLE finance_payables ALTER COLUMN payee_id DROP NOT NULL;
ALTER TABLE finance_payables ADD CONSTRAINT finance_payables_payee_identity_valid CHECK ((
 (payee_id IS NOT DISTINCT FROM data->>'payeeId')
 AND (payee_id IS NOT DISTINCT FROM data->'payeeSnapshot'->>'id')
 AND (payee_id IS NOT NULL OR (
   data->'payeeId' = 'null'::jsonb
   AND data->'payeeSnapshot'->'id' = 'null'::jsonb
   AND data->'payeeSnapshot'->>'name' = 'Payee not specified'
   AND data->>'paymentArrangement' = 'ALREADY_PAID'
   AND jsonb_typeof(data->'paidDetails') = 'object'
 ))
) IS TRUE);
-- Keep duplicate-document protection within the explicitly unidentified bucket.
CREATE UNIQUE INDEX finance_payables_unnamed_reference_idx
 ON finance_payables(document_reference) WHERE payee_id IS NULL;
