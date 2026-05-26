from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

try:
    from system_settings import ensure_location_record
except Exception:  # pragma: no cover - keeps module usable before System Settings is wired.
    ensure_location_record = None


router = APIRouter(prefix="/api/customer-profiling", tags=["customer-profiling"])

customers: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None

CUSTOMER_TYPES = ["RESIDENTIAL", "BUSINESS", "ENTERPRISE"]
CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"]
CUSTOMER_GENDERS = ["MALE", "FEMALE"]
PROVINCES = ["CAGAYAN", "ISABELA"]
MUNICIPALITIES_BY_PROVINCE = {
    "CAGAYAN": [
        "ABULUG",
        "ALCALA",
        "ALLACAPAN",
        "AMULUNG",
        "APARRI",
        "BAGGAO",
        "BALLESTEROS",
        "BUGUEY",
        "CALAYAN",
        "CAMALANIUGAN",
        "CLAVERIA",
        "ENRILE",
        "GATTARAN",
        "GONZAGA",
        "IGUIG",
        "LAL-LO",
        "LASAM",
        "PAMPLONA",
        "PENABLANCA",
        "PIAT",
        "RIZAL",
        "SANCHEZ-MIRA",
        "SANTA ANA",
        "SANTA PRAXEDES",
        "SANTA TERESITA",
        "SANTO NINO",
        "SOLANA",
        "TUAO",
        "TUGUEGARAO CITY",
    ],
    "ISABELA": [
        "ALICIA",
        "ANGADANAN",
        "AURORA",
        "BENITO SOLIVEN",
        "BURGOS",
        "CABAGAN",
        "CABATUAN",
        "CAUAYAN CITY",
        "CORDON",
        "DINAPIGUE",
        "DIVILACAN",
        "ECHAGUE",
        "GAMU",
        "ILAGAN CITY",
        "JONES",
        "LUNA",
        "MACONACON",
        "MALLIG",
        "NAGUILIAN",
        "PALANAN",
        "QUEZON",
        "QUIRINO",
        "RAMON",
        "REINA MERCEDES",
        "ROXAS",
        "SAN AGUSTIN",
        "SAN GUILLERMO",
        "SAN ISIDRO",
        "SAN MANUEL",
        "SAN MARIANO",
        "SAN MATEO",
        "SAN PABLO",
        "SANTA MARIA",
        "SANTIAGO CITY",
        "SANTO TOMAS",
        "TUMAUINI",
    ],
}
BARANGAYS_BY_PROVINCE_CITY = {
    "CAGAYAN::ENRILE": [
        "ALIBAGO",
        "BARANGAY I",
        "BARANGAY II",
        "BARANGAY III",
        "BARANGAY III-A",
        "BARANGAY IV",
        "BATU",
        "DIVISORIA",
        "INGA",
        "LANNA",
        "LEMU NORTE",
        "LEMU SUR",
        "LIWAN NORTE",
        "LIWAN SUR",
        "MADDARULUG NORTE",
        "MADDARULUG SUR",
        "MAGALALAG EAST",
        "MAGALALAG WEST",
        "MARRACURU",
        "ROMA NORTE",
        "ROMA SUR",
        "SAN ANTONIO",
    ],
    "ISABELA::SANTA MARIA": [
        "BANGAD",
        "BUENAVISTA",
        "CALAMAGUI EAST",
        "CALAMAGUI NORTH",
        "CALAMAGUI WEST",
        "DIVISORIA",
        "LINGALING",
        "MOZZOZZIN NORTH",
        "MOZZOZZIN SUR",
        "NAGANACAN",
        "POBLACION 1",
        "POBLACION 2",
        "POBLACION 3",
        "POBLACION GK",
        "POBLACION BLISS",
        "QUINAGABIAN",
        "SAN ANTONIO",
        "SAN ISIDRO EAST",
        "SAN ISIDRO WEST",
        "SAN RAFAEL EAST",
        "SAN RAFAEL WEST",
        "VILLABUENA",
    ],
    "ISABELA::CABAGAN": [
        "AGGUB",
        "ANNARONAN",
        "ANAO",
        "ANGANCASILIAN",
        "BALASIG",
        "CATABAYUNGAN",
        "CENTRO",
        "GARITA",
        "LUQUILU",
        "MAGLETICIA",
        "MASIPI EAST",
        "MASIPI WEST",
        "NGARAG",
        "SAN ANTONIO",
        "SAN BERNARDO",
        "SAN JUAN",
        "SAN PABLO",
        "SANTA MARIA",
        "SARANAY",
        "SAUI",
        "TALLAG",
        "UGAD",
        "UNION",
        "VILLAFLOR",
        "VILLAHERMOSA",
        "VILLA IMELDA",
        "VILLA JESUSA",
    ],
}
BULK_UPLOAD_HEADERS = [
    "accountNumber",
    "firstName",
    "middleName",
    "lastName",
    "businessName",
    "birthDate",
    "contactNumber",
    "alternateMobileNumber",
    "facebookAccountName",
    "facebookProfileLink",
    "email",
    "addressLine1",
    "addressLine2",
    "locationId",
    "locationName",
    "landmark",
    "province",
    "city",
    "barangay",
    "latitude",
    "longitude",
    "gender",
    "customerType",
    "status",
]
REQUIRED_BULK_UPLOAD_HEADERS = [
    "firstName",
    "lastName",
    "contactNumber",
]


class CustomerPayload(BaseModel):
    accountNumber: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    middleName: str | None = None
    businessName: str | None = None
    birthDate: str | None = None
    contactNumber: str | None = None
    alternateMobileNumber: str | None = None
    facebookAccountName: str | None = None
    facebookProfileLink: str | None = None
    secondaryContacts: list[dict[str, Any]] = Field(default_factory=list)
    secondaryContactName: str | None = None
    secondaryContactNumber: str | None = None
    secondaryContactFacebookAccount: str | None = None
    secondaryContactRelationship: str | None = None
    email: str | None = None
    locationId: str | None = None
    locationName: str | None = None
    landmark: str | None = None
    addressLine1: str | None = None
    addressLine2: str | None = None
    barangay: str | None = None
    city: str | None = None
    province: str | None = None
    latitude: str | float | None = None
    longitude: str | float | None = None
    gender: str | None = None
    customerType: str | None = None
    status: str | None = None


def configure_customer_profiling(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
) -> None:
    global _current_admin, _audit_logger
    _current_admin = current_admin
    _audit_logger = audit_logger


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Customer Profiling module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    return value


def customer_full_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if part)


def visible_customers() -> list[dict[str, Any]]:
    return [customer for customer in customers if not customer.get("deletedAt")]


def customer_summary(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        **customer,
        "fullName": customer_full_name(customer),
    }


def count_by(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for row in rows:
        value = str(row.get(field) or "UNSPECIFIED")
        counts[value] = counts.get(value, 0) + 1
    return [{"name": key, "count": counts[key]} for key in sorted(counts, key=lambda item: counts[item], reverse=True)]


def customer_metrics() -> dict[str, int]:
    rows = visible_customers()
    return {
        "customers": len(rows),
        "active": sum(1 for customer in rows if customer.get("status") == "ACTIVE"),
        "pending": sum(1 for customer in rows if customer.get("status") == "PENDING"),
    }


def generate_account_number() -> str:
    existing = {customer["accountNumber"] for customer in customers}
    seed = 58392741
    candidate = seed + len(existing) * 7919
    while True:
        account_number = str(candidate % 90000000 + 10000000)
        if account_number not in existing:
            return account_number
        candidate += 7919


def find_customer(customer_id: str) -> dict[str, Any]:
    for customer in customers:
        if customer["id"] == customer_id and not customer.get("deletedAt"):
            return customer
    raise HTTPException(status_code=404, detail="Customer not found")


def build_duplicate_fingerprint(data: dict[str, Any]) -> str:
    return "|".join(
        [
            normalize_upper(data.get("firstName")),
            normalize_upper(data.get("lastName")),
            normalize_upper(data.get("landmark")),
            normalize_upper(data.get("addressLine1")),
            normalize_upper(data.get("province")),
            normalize_upper(data.get("city")),
            normalize_upper(data.get("barangay")),
            str(data.get("latitude") or "").strip(),
            str(data.get("longitude") or "").strip(),
        ],
    )


def ensure_customer_location(record: dict[str, Any], admin: dict[str, Any] | None = None) -> None:
    if ensure_location_record is None:
        return
    location_data = {
        "locationId": record.get("locationId"),
        "location_name": record.get("locationName") or record.get("landmark") or record.get("barangay") or record.get("city") or record.get("addressLine1"),
        "address": record.get("addressLine1"),
        "municipality": record.get("city"),
        "barangay": record.get("barangay"),
        "province": record.get("province"),
        "latitude": record.get("latitude") or None,
        "longitude": record.get("longitude") or None,
        "geocode_source": "CUSTOMER_PROFILING",
        "notes": f"Created or linked from Customer Profiling. Landmark: {record.get('landmark') or 'Not specified'}. Complete missing details in System Settings > Location Management.",
    }
    location = ensure_location_record(location_data, actor=admin)
    if location:
        record["locationId"] = location.get("id") or record.get("locationId") or ""
        record["locationName"] = location.get("location_name") or record.get("locationName") or ""


def assert_no_duplicate_customer(candidate: dict[str, Any], ignore_id: str | None = None) -> None:
    fingerprint = build_duplicate_fingerprint(candidate)
    if not fingerprint.replace("|", ""):
        return
    for customer in visible_customers():
        if ignore_id and customer["id"] == ignore_id:
            continue
        if build_duplicate_fingerprint(customer) == fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Duplicate customer detected for the same name and service address.",
            )


def customer_payload_to_record(payload: CustomerPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    base = dict(current or {})
    incoming = payload.model_dump(exclude_unset=True)
    for key, value in incoming.items():
        base[key] = value or [] if key == "secondaryContacts" else clean_value(value)

    required = [
        "firstName",
        "lastName",
        "contactNumber",
    ]
    missing = [field for field in required if not base.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required customer fields: {', '.join(missing)}")

    base["customerType"] = normalize_upper(base.get("customerType") or "RESIDENTIAL")
    base["status"] = normalize_upper(base.get("status") or "ACTIVE")
    base["gender"] = normalize_upper(base.get("gender") or "MALE")
    base["businessName"] = clean_value(base.get("businessName")) or ""
    base["birthDate"] = clean_value(base.get("birthDate")) or ""
    base["province"] = normalize_upper(base.get("province"))
    base["city"] = normalize_upper(base.get("city"))
    base["barangay"] = normalize_upper(base.get("barangay"))
    base["locationName"] = clean_value(base.get("locationName")) or ""

    if base["customerType"] not in CUSTOMER_TYPES:
        raise HTTPException(status_code=400, detail="Invalid customer type")
    if base["customerType"] == "BUSINESS" and not base["businessName"]:
        raise HTTPException(status_code=400, detail="Business Name is required for business customers.")
    if base["status"] not in CUSTOMER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid customer status")
    if base["gender"] not in CUSTOMER_GENDERS:
        raise HTTPException(status_code=400, detail="Invalid customer gender")

    secondary = list(base.get("secondaryContacts") or [])
    if base.get("secondaryContactName") and not secondary:
        secondary.append(
            {
                "name": base.get("secondaryContactName"),
                "contactNumber": base.get("secondaryContactNumber"),
                "facebookAccount": base.get("secondaryContactFacebookAccount"),
                "relationship": base.get("secondaryContactRelationship"),
            },
        )
    base["secondaryContacts"] = secondary
    return base


def seed_customer_data() -> None:
    if customers:
        return
    created_at = now_iso()
    seed_rows = [
        {
            "accountNumber": "58392741",
            "firstName": "MARIA",
            "lastName": "SANTOS",
            "middleName": "LOPEZ",
            "birthDate": "2002-05-18",
            "contactNumber": "09171234567",
            "alternateMobileNumber": "09180000001",
            "facebookAccountName": "MARIA SANTOS",
            "facebookProfileLink": "https://www.facebook.com/maria.santos",
            "email": "maria.santos@example.com",
            "addressLine1": "BLK 12 LOT 5 SAN ISIDRO VILLAGE",
            "locationName": "ALIBAGO",
            "barangay": "ALIBAGO",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "17.559311",
            "longitude": "121.684928",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [{"name": "PEDRO SANTOS", "contactNumber": "09175551234", "relationship": "Spouse"}],
        },
        {
            "accountNumber": "76149028",
            "firstName": "JUAN",
            "lastName": "DELA CRUZ",
            "businessName": "DELA CRUZ SARI-SARI STORE",
            "birthDate": "1995-09-12",
            "contactNumber": "09180000001",
            "facebookAccountName": "JUAN DELA CRUZ",
            "email": "juan.delacruz@example.com",
            "addressLine1": "PUROK 1",
            "addressLine2": "",
            "locationName": "BATU",
            "barangay": "BATU",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
            "customerType": "BUSINESS",
            "status": "PENDING",
            "secondaryContacts": [{"name": "ANA DELA CRUZ", "contactNumber": "09181230000", "relationship": "Owner"}],
        },
        {
            "accountNumber": "83476195",
            "firstName": "ANGELA",
            "lastName": "REYES",
            "birthDate": "1999-01-24",
            "contactNumber": "09180000002",
            "facebookAccountName": "ANGELA REYES",
            "email": "a.reyes@example.com",
            "addressLine1": "SUNSET HOMES PHASE 2",
            "locationName": "DIVISORIA",
            "barangay": "DIVISORIA",
            "city": "SANTA MARIA",
            "province": "ISABELA",
            "latitude": "",
            "longitude": "",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [],
        },
        {
            "accountNumber": "67921453",
            "firstName": "KERVIN",
            "lastName": "TAN",
            "birthDate": "1988-07-03",
            "contactNumber": "09180000003",
            "facebookAccountName": "KERVIN TAN",
            "email": "kervin.tan@example.com",
            "addressLine1": "8 INDUSTRIAL ROAD",
            "locationName": "CENTRO",
            "barangay": "CENTRO",
            "city": "CABAGAN",
            "province": "ISABELA",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
            "customerType": "ENTERPRISE",
            "status": "SUSPENDED",
            "secondaryContacts": [{"name": "LIZA TAN", "contactNumber": "09189999999", "relationship": "Office Admin"}],
        },
        {
            "accountNumber": "94573268",
            "firstName": "LIZA",
            "lastName": "GARCIA",
            "birthDate": "2001-11-09",
            "contactNumber": "09180000004",
            "facebookAccountName": "LIZA GARCIA",
            "addressLine1": "24 MAPLE ST",
            "locationName": "SAN ANTONIO",
            "barangay": "SAN ANTONIO",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "",
            "longitude": "",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [],
        },
    ]
    for row in seed_rows:
        ensure_customer_location(row, {"id": "seed", "username": "seed"})
        customers.append(
            {
                "id": str(uuid4()),
                "createdAt": created_at,
                "updatedAt": created_at,
                "deletedAt": None,
                "createdByUserId": "seed",
                "updatedByUserId": "seed",
                **row,
            },
        )
@router.get("/meta")
def customer_profiling_meta(admin=Depends(require_admin)):
    cities = sorted({city for cities in MUNICIPALITIES_BY_PROVINCE.values() for city in cities})
    barangays = sorted({barangay for barangays in BARANGAYS_BY_PROVINCE_CITY.values() for barangay in barangays})
    return {
        "customerTypes": CUSTOMER_TYPES,
        "customerStatuses": CUSTOMER_STATUSES,
        "customerGenders": CUSTOMER_GENDERS,
        "provinces": PROVINCES,
        "cities": cities,
        "citiesByProvince": MUNICIPALITIES_BY_PROVINCE,
        "barangays": barangays,
        "barangaysByProvinceCity": BARANGAYS_BY_PROVINCE_CITY,
        "bulkUploadHeaders": BULK_UPLOAD_HEADERS,
        "requiredBulkUploadHeaders": REQUIRED_BULK_UPLOAD_HEADERS,
    }


@router.get("/customers/overview")
def customer_overview(admin=Depends(require_admin)):
    seed_customer_data()
    rows = visible_customers()
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "totalCustomers": len(rows),
        "activeCustomers": sum(1 for customer in rows if customer["status"] == "ACTIVE"),
        "pendingCustomers": sum(1 for customer in rows if customer["status"] == "PENDING"),
        "suspendedCustomers": sum(1 for customer in rows if customer["status"] == "SUSPENDED"),
        "enrileCustomers": sum(1 for customer in rows if customer["province"] == "CAGAYAN" and customer["city"] == "ENRILE"),
        "newCustomersThisMonth": sum(1 for customer in rows if str(customer.get("createdAt", "")).startswith(current_month)),
        "averageNewCustomersLast6Months": round(len(rows) / 6, 2),
        "trendDirection": "FLAT",
        "trendDelta": 0,
        "byCustomerType": count_by(rows, "customerType"),
        "municipalities": [{"city": item["name"], "count": item["count"]} for item in count_by(rows, "city")],
        "topBarangays": [{"barangay": item["name"], "count": item["count"]} for item in count_by(rows, "barangay")[:10]],
    }


@router.get("/customers")
def list_customers(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=10, ge=1, le=100),
    search: str = "",
    customerType: str = "",
    status: str = "",
    province: str = "",
    city: str = "",
    barangay: str = "",
    sortBy: str = "createdAt",
    sortDir: str = "desc",
    admin=Depends(require_admin),
):
    seed_customer_data()
    rows = visible_customers()
    if search:
        needle = search.strip().lower()
        searchable_fields = [
            "accountNumber",
            "firstName",
            "middleName",
            "lastName",
            "contactNumber",
            "alternateMobileNumber",
            "facebookAccountName",
            "email",
        ]
        rows = [
            customer
            for customer in rows
            if needle in customer_full_name(customer).lower()
            or any(needle in str(customer.get(field) or "").lower() for field in searchable_fields)
        ]
    if customerType:
        rows = [customer for customer in rows if customer.get("customerType") == normalize_upper(customerType)]
    if status:
        rows = [customer for customer in rows if customer.get("status") == normalize_upper(status)]
    if province:
        rows = [customer for customer in rows if normalize_upper(province) in customer.get("province", "")]
    if city:
        rows = [customer for customer in rows if normalize_upper(city) in customer.get("city", "")]
    if barangay:
        rows = [customer for customer in rows if normalize_upper(barangay) in customer.get("barangay", "")]

    sortable_fields = {
        "accountNumber": lambda customer: str(customer.get("accountNumber") or "").lower(),
        "fullName": lambda customer: customer_full_name(customer).lower(),
        "businessName": lambda customer: str(customer.get("businessName") or "").lower(),
        "birthDate": lambda customer: str(customer.get("birthDate") or "").lower(),
        "contactNumber": lambda customer: str(customer.get("contactNumber") or "").lower(),
        "alternateMobileNumber": lambda customer: str(customer.get("alternateMobileNumber") or "").lower(),
        "facebookAccountName": lambda customer: str(customer.get("facebookAccountName") or "").lower(),
        "facebookProfileLink": lambda customer: str(customer.get("facebookProfileLink") or "").lower(),
        "email": lambda customer: str(customer.get("email") or "").lower(),
        "secondaryContacts": lambda customer: " ".join(
            str(contact.get(field) or "").lower()
            for contact in customer.get("secondaryContacts", [])
            for field in ["name", "relationship", "contactNumber"]
        ),
        "customerType": lambda customer: str(customer.get("customerType") or "").lower(),
        "status": lambda customer: str(customer.get("status") or "").lower(),
        "locationName": lambda customer: str(customer.get("locationName") or customer.get("locationId") or "").lower(),
        "landmark": lambda customer: str(customer.get("landmark") or "").lower(),
        "province": lambda customer: str(customer.get("province") or "").lower(),
        "city": lambda customer: str(customer.get("city") or "").lower(),
        "barangay": lambda customer: str(customer.get("barangay") or "").lower(),
        "address": lambda customer: " ".join(
            str(customer.get(field) or "").lower()
            for field in ["province", "city", "barangay", "addressLine1", "addressLine2"]
        ),
        "coordinates": lambda customer: f"{customer.get('longitude') or ''} {customer.get('latitude') or ''}".lower(),
        "longitude": lambda customer: str(customer.get("longitude") or "").lower(),
        "latitude": lambda customer: str(customer.get("latitude") or "").lower(),
        "createdAt": lambda customer: str(customer.get("createdAt") or "").lower(),
    }
    reverse = sortDir.lower() != "asc"
    sort_key = sortable_fields.get(sortBy, sortable_fields["createdAt"])
    rows = sorted(rows, key=sort_key, reverse=reverse)
    total = len(rows)
    start = (page - 1) * pageSize
    end = start + pageSize
    return {
        "data": [customer_summary(customer) for customer in rows[start:end]],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "totalPages": max(1, (total + pageSize - 1) // pageSize),
    }


@router.get("/customers/bulk-upload-template")
def customer_bulk_upload_template(admin=Depends(require_admin)):
    return {
        "filename": "customer-bulk-upload-template.csv",
        "headers": BULK_UPLOAD_HEADERS,
        "sample": {
            "accountNumber": "",
            "firstName": "JUAN",
            "middleName": "D",
            "lastName": "DELA CRUZ",
            "businessName": "",
            "birthDate": "2002-05-18",
            "contactNumber": "09171234567",
            "alternateMobileNumber": "09180000001",
            "facebookAccountName": "JUAN DELA CRUZ",
            "facebookProfileLink": "https://www.facebook.com/juan.delacruz",
            "email": "juan.delacruz@example.com",
            "addressLine1": "PUROK 1",
            "addressLine2": "",
            "locationId": "",
            "locationName": "ALIBAGO",
            "landmark": "ALIBAGO",
            "province": "CAGAYAN",
            "city": "ENRILE",
            "barangay": "ALIBAGO",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
        },
        "allowedValues": {
            "customerType": CUSTOMER_TYPES,
            "gender": CUSTOMER_GENDERS,
            "province": PROVINCES,
            "status": CUSTOMER_STATUSES,
        },
    }


@router.get("/customers/{customer_id}")
def get_customer(customer_id: str, admin=Depends(require_admin)):
    seed_customer_data()
    return customer_summary(find_customer(customer_id))


@router.post("/customers")
def create_customer(payload: CustomerPayload, request: Request, admin=Depends(require_admin)):
    seed_customer_data()
    record = customer_payload_to_record(payload)
    if record.get("accountNumber") and any(
        customer["accountNumber"] == record["accountNumber"] and not customer.get("deletedAt") for customer in customers
    ):
        raise HTTPException(status_code=409, detail="Account number already exists")
    record["accountNumber"] = record.get("accountNumber") or generate_account_number()
    assert_no_duplicate_customer(record)
    ensure_customer_location(record, admin)
    timestamp = now_iso()
    customer = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        "createdByUserId": admin["id"],
        "updatedByUserId": admin["id"],
        **record,
    }
    customers.append(customer)
    add_audit(
        "customer_created",
        "Customer",
        customer["id"],
        {"accountNumber": customer["accountNumber"], "client": request.client.host if request.client else None},
        admin["username"],
    )
    return customer_summary(customer)


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, payload: CustomerPayload, admin=Depends(require_admin)):
    seed_customer_data()
    current = find_customer(customer_id)
    record = customer_payload_to_record(payload, current)
    if record.get("accountNumber") and any(
        customer["accountNumber"] == record["accountNumber"] and customer["id"] != customer_id and not customer.get("deletedAt")
        for customer in customers
    ):
        raise HTTPException(status_code=409, detail="Account number already exists")
    assert_no_duplicate_customer(record, ignore_id=customer_id)
    ensure_customer_location(record, admin)
    current.update(record)
    current["updatedAt"] = now_iso()
    current["updatedByUserId"] = admin["id"]
    add_audit("customer_updated", "Customer", current["id"], {"accountNumber": current["accountNumber"]}, admin["username"])
    return customer_summary(current)


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: str, admin=Depends(require_admin)):
    seed_customer_data()
    current = find_customer(customer_id)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = now_iso()
    current["updatedByUserId"] = admin["id"]
    add_audit("customer_deleted", "Customer", current["id"], {"accountNumber": current["accountNumber"]}, admin["username"])
    return {"status": "ok"}
