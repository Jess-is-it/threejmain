"""Collector owns custody confirmation and actual remittance attestations."""
from fastapi import Depends
from finance.integration import CaptureProvider, IntegrationStore, SourceResolution


class CollectorFinanceFeed(CaptureProvider):
    def __init__(self, authorize, store=None):
        super().__init__('collector', authorize, store)


def install_finance_recovery(router, require_confirm, audit_logger):
    @router.post('/finance/recovery/{sequence}')
    def attest_source(sequence: int, payload: SourceResolution, admin=Depends(require_confirm)):
        result = IntegrationStore().resolve('collector', sequence, payload, admin['username'])
        audit_logger('collector_finance_movement_attested', 'CollectorFinanceChange', str(sequence), {'sequence': sequence}, admin['username'])
        return result
