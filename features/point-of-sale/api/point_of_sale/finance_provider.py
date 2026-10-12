"""POS delegates subscriber receipts to Billing and retains register evidence."""
from fastapi import Depends
from finance.integration import CaptureProvider, IntegrationStore, SourceResolution


class PosFinanceFeed(CaptureProvider):
    def __init__(self, authorize, store=None):
        super().__init__('point-of-sale', authorize, store)


def install_finance_recovery(router, require_editor, audit_logger):
    @router.post('/finance/recovery/{sequence}')
    def attest_source(sequence: int, payload: SourceResolution, admin=Depends(require_editor)):
        result = IntegrationStore().resolve('point-of-sale', sequence, payload, admin['username'])
        audit_logger('pos_finance_evidence_attested', 'POSFinanceChange', str(sequence), {'sequence': sequence}, admin['username'])
        return result
