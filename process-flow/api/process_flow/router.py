from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException

router = APIRouter(prefix="/api/process-flow", tags=["process-flow"])

_current_admin = None


def configure_process_flow(current_admin):
    global _current_admin
    _current_admin = current_admin


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Process Flow module is not configured")
    return _current_admin(authorization)


FLOWS = [
    {
        "id": "new-customer-active-service",
        "title": "New Customer To Active Service",
        "summary": "A customer profile becomes an active internet service through Service Order approval, Ticket completion, and Service Account activation.",
        "modules": ["Customer Profiling", "Service Account", "Service Order", "Ticketing", "Billing"],
        "stages": [
            {"title": "Create Customer Profile", "module": "Customer Profiling", "status": "Identity only", "detail": "No Service Account, Service Order, Ticket, or Billing record is created automatically."},
            {"title": "Customer Appears Without Service", "module": "Service Account", "status": "No service account", "detail": "The customer is visible as a non-service account candidate."},
            {"title": "Create New Installation Order", "module": "Service Order", "status": "Draft or submitted", "detail": "CSR selects the customer, service plan, address, and installation details."},
            {"title": "Approve Installation Request", "module": "Service Order", "status": "Approved", "detail": "The system creates a Service Account with Pending Installation status."},
            {"title": "Create Installation Ticket", "module": "Ticketing", "status": "Open", "detail": "Operations receives the work item for field installation."},
            {"title": "Complete Installation", "module": "Ticketing", "status": "Completed", "detail": "Technician confirms the customer service was installed."},
            {"title": "Activate Service Account", "module": "Service Account", "status": "Active", "detail": "The Service Account stores the current plan, address, status, and activation date."},
            {"title": "Start Billing", "module": "Billing", "status": "Current", "detail": "Billing uses the active Service Account as the billable subscription target."},
        ],
    },
    {
        "id": "outstanding-balance",
        "title": "Customer With Outstanding Balance",
        "summary": "Billing collections can trigger suspension, disconnection, payment, or reconnection workflows.",
        "modules": ["Billing", "Service Account", "Service Order", "Ticketing"],
        "stages": [
            {"title": "Invoice Becomes Overdue", "module": "Billing", "status": "Overdue", "detail": "Billing remains the source of truth for balances and payment status."},
            {"title": "Review Customer Service", "module": "Service Account", "status": "Active", "detail": "The service account shows billing summary but does not replace Billing."},
            {"title": "Create Suspension Order", "module": "Service Order", "status": "Submitted", "detail": "Staff creates the appropriate request when policy requires service action."},
            {"title": "Process Suspension Ticket", "module": "Ticketing", "status": "In progress", "detail": "Operations performs network or field work as needed."},
            {"title": "Update Account Status", "module": "Service Account", "status": "Suspended", "detail": "Completed suspension order changes the current service state."},
            {"title": "Payment Or Collection", "module": "Billing", "status": "Current or for collection", "detail": "Payment can lead to reconnection; unresolved debt can lead to disconnection."},
        ],
    },
    {
        "id": "plan-change",
        "title": "Plan Upgrade Or Downgrade",
        "summary": "A Service Order changes the current Service Catalog plan on an existing Service Account.",
        "modules": ["Service Account", "Service Catalog", "Service Order", "Billing"],
        "stages": [
            {"title": "Select Existing Service Account", "module": "Service Account", "status": "Active", "detail": "Plan changes require an existing service line."},
            {"title": "Choose Requested Plan", "module": "Service Catalog", "status": "Active plan", "detail": "Upgrade/downgrade uses catalog items, not manual plan text."},
            {"title": "Create Plan Change Order", "module": "Service Order", "status": "Draft", "detail": "System validates that the selected plan is truly higher or lower."},
            {"title": "Complete Request", "module": "Service Order", "status": "Completed", "detail": "The completed order updates the Service Account plan."},
            {"title": "Update Recurring Charge", "module": "Billing", "status": "Pending billing sync", "detail": "Billing should use the Service Account plan/rate as the billable source."},
        ],
    },
    {
        "id": "relocation",
        "title": "Relocation",
        "summary": "A relocation order changes the installed service address and may require ticket/network updates.",
        "modules": ["Service Account", "Service Order", "Ticketing", "Network Settings"],
        "stages": [
            {"title": "Open Existing Service Account", "module": "Service Account", "status": "Active", "detail": "Current address is read-only context."},
            {"title": "Enter New Service Address", "module": "Service Order", "status": "Draft", "detail": "Only the requested new address is editable."},
            {"title": "Coverage And Network Review", "module": "Network Settings", "status": "Required", "detail": "Staff checks area, OLT, PON, NAP, and port availability."},
            {"title": "Dispatch Relocation Ticket", "module": "Ticketing", "status": "Open", "detail": "Technician performs the transfer work."},
            {"title": "Update Service Account Address", "module": "Service Account", "status": "Updated", "detail": "Completed relocation order updates the final current address."},
        ],
    },
    {
        "id": "suspension-reconnection",
        "title": "Suspension And Reconnection",
        "summary": "Temporary suspension and reconnection orders change service availability while preserving the account.",
        "modules": ["Service Account", "Service Order", "Ticketing", "Billing"],
        "stages": [
            {"title": "Start From Active Account", "module": "Service Account", "status": "Active", "detail": "Only active services should be suspended."},
            {"title": "Create Suspension Order", "module": "Service Order", "status": "Submitted", "detail": "Reason and target period are recorded."},
            {"title": "Complete Suspension", "module": "Service Account", "status": "Suspended", "detail": "The service remains recoverable."},
            {"title": "Resolve Requirement", "module": "Billing or CSR", "status": "Eligible", "detail": "Payment or customer request may make reconnection valid."},
            {"title": "Create Reconnection Order", "module": "Service Order", "status": "Submitted", "detail": "Reconnection requires suspended or disconnected service."},
            {"title": "Complete Reconnection", "module": "Service Account", "status": "Active", "detail": "Service state returns to active."},
        ],
    },
    {
        "id": "disconnection-termination",
        "title": "Disconnection Or Termination",
        "summary": "Service moves from active/suspended to pending disconnection, disconnected, and possibly terminated.",
        "modules": ["Service Account", "Service Order", "Ticketing", "Inventory", "Billing"],
        "stages": [
            {"title": "Review Account And Balance", "module": "Service Account", "status": "Active or suspended", "detail": "Billing balance and equipment obligations are reviewed."},
            {"title": "Create Disconnection Order", "module": "Service Order", "status": "Submitted", "detail": "Reason, target date, and retrieval requirement are captured."},
            {"title": "Mark Pending Disconnection", "module": "Service Account", "status": "Pending Disconnection", "detail": "Approved/in-progress order shows the service is being cut off."},
            {"title": "Complete Disconnection Work", "module": "Ticketing", "status": "Completed", "detail": "Network/field work completes the disconnection."},
            {"title": "Retrieve Equipment", "module": "Inventory", "status": "As required", "detail": "Company-owned CPE should be retrieved or marked lost/damaged."},
            {"title": "Close Or Collect", "module": "Billing", "status": "Closed or for collection", "detail": "Billing closes recurring charges or continues collection workflow."},
        ],
    },
    {
        "id": "equipment-replacement",
        "title": "Equipment Replacement",
        "summary": "A replacement order coordinates Ticketing and Inventory while Service Account keeps the assigned-equipment summary.",
        "modules": ["Service Account", "Service Order", "Ticketing", "Inventory"],
        "stages": [
            {"title": "Review Assigned Equipment", "module": "Service Account", "status": "Current device", "detail": "Account shows assigned ONU/router summary."},
            {"title": "Create Replacement Order", "module": "Service Order", "status": "Submitted", "detail": "Equipment type, reason, and target date are captured."},
            {"title": "Reserve Replacement Asset", "module": "Inventory", "status": "Reserved", "detail": "Inventory remains the asset source of truth."},
            {"title": "Complete Field Ticket", "module": "Ticketing", "status": "Completed", "detail": "Technician replaces the device and records outcome."},
            {"title": "Update Assignment Summary", "module": "Service Account", "status": "Updated", "detail": "Account shows the latest assigned equipment details."},
        ],
    },
    {
        "id": "add-on-service",
        "title": "Add-on Service",
        "summary": "An add-on request selects an eligible catalog item, creates an operations ticket when needed, and updates billing after provisioning.",
        "modules": ["Service Account", "Service Catalog", "Service Order", "Ticketing", "Billing"],
        "stages": [
            {"title": "Open Active Service Account", "module": "Service Account", "status": "Active", "detail": "Add-ons are attached to an existing service line."},
            {"title": "Select Add-on Catalog Item", "module": "Service Catalog", "status": "Active add-on", "detail": "Examples include Static IP, mesh WiFi, or extra router service."},
            {"title": "Create Add-on Order", "module": "Service Order", "status": "Submitted", "detail": "The order records effective date and provisioning notes."},
            {"title": "Provision Add-on", "module": "Ticketing", "status": "In Progress", "detail": "Ticketing coordinates any network or field work required."},
            {"title": "Update Recurring Charges", "module": "Billing", "status": "Pending billing sync", "detail": "Billing should include the add-on charge once provisioning is complete."},
        ],
    },
    {
        "id": "change-ownership",
        "title": "Change Ownership",
        "summary": "A Service Order transfers an existing Service Account from one Customer Profile to another with an auditable approval trail.",
        "modules": ["Customer Profiling", "Service Account", "Service Order", "Billing"],
        "stages": [
            {"title": "Select Current Service Account", "module": "Service Account", "status": "Active", "detail": "The existing owner and current service line are read-only context."},
            {"title": "Select New Customer Profile", "module": "Customer Profiling", "status": "Verified identity", "detail": "The new owner must already exist as a Customer Profile."},
            {"title": "Create Ownership Order", "module": "Service Order", "status": "Pending Review", "detail": "The order records transfer reason, effective date, and approval reference."},
            {"title": "Complete Transfer", "module": "Service Account", "status": "Owner updated", "detail": "The Service Account customer link moves to the selected new owner."},
            {"title": "Review Billing Responsibility", "module": "Billing", "status": "Pending billing sync", "detail": "Billing should confirm who owns past due and future charges."},
        ],
    },
    {
        "id": "network-provisioning",
        "title": "Network Provisioning",
        "summary": "Network details are assigned after service approval and reflected on the Service Account.",
        "modules": ["Network Settings", "Service Account", "Ticketing"],
        "stages": [
            {"title": "Confirm Access Area", "module": "Network Settings", "status": "Available", "detail": "OLT, PON, NAP, FBT, port, and VLAN capacity are checked."},
            {"title": "Assign Network Details", "module": "Network Settings", "status": "Provisioned", "detail": "PPPoE, bandwidth profile, VLAN, MAC, or static IP are assigned."},
            {"title": "Install And Test", "module": "Ticketing", "status": "Completed", "detail": "Technician verifies signal and customer connectivity."},
            {"title": "Reflect Current Network", "module": "Service Account", "status": "Active", "detail": "Service Account displays key network details without replacing Network Settings."},
        ],
    },
]


def process_flow_metrics() -> dict[str, int]:
    return {"flows": len(FLOWS), "stages": sum(len(flow["stages"]) for flow in FLOWS)}


@router.get("/overview")
def process_flow_overview(admin=Depends(require_admin)):
    return {"metrics": process_flow_metrics(), "flows": [{"id": flow["id"], "title": flow["title"], "stages": len(flow["stages"])} for flow in FLOWS]}


@router.get("/flows")
def process_flows(admin=Depends(require_admin)):
    return FLOWS
