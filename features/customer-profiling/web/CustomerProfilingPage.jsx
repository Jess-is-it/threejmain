import React, { useEffect, useRef, useState } from 'react';
import {
  IconActivity,
  IconAddressBook,
  IconCalendarEvent,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardCheck,
  IconClipboardList,
  IconClock,
  IconColumns,
  IconCurrentLocation,
  IconDeviceFloppy,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconFileSpreadsheet,
  IconFilter,
  IconHome,
  IconHomeSignal,
  IconMapPin,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconArrowsSort,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconX
} from '@tabler/icons-react';
import CustomerEmotionAvatar from '../../system-settings/web/CustomerEmotionAvatar';
import {
  createMapProviderSession,
  defaultMapProvider,
  enabledMapProviders,
  mapProviderById,
  mapProviderNeedsSession,
  mapProviderTileUrl,
  mapProviderWithSession,
  normalizeMapProviderSettings
} from '../../system-settings/web/mapProviders';
import './customerProfiling.css';

const API = '/api';
const CUSTOMER_DRAFT_STORAGE_KEY = 'threejmain_customer_profile_drafts';
const CUSTOMER_TABLE_COLUMN_STORAGE_PREFIX = 'threejmain_customer_profile_table_columns';
const DEFAULT_CAPTURE_COORDINATES = { latitude: 17.559311, longitude: 121.684928 };
const COORDINATE_CAPTURE_ZOOM = 15;
const COORDINATE_CAPTURE_MIN_ZOOM = 12;
const COORDINATE_CAPTURE_MAX_ZOOM = 19;
const MAP_TILE_SIZE = 256;
const MAP_TILE_COUNT = 3;
const CUSTOMER_COLUMN_MENU_WIDTH = 304;

function token() {
  return localStorage.getItem('threejmain_token');
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'online'].includes(normalized)) return 'bg-green-lt text-green';
  if (['pending', 'paused'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['suspended', 'terminated', 'inactive'].includes(normalized)) return 'bg-red-lt text-red';
  return 'bg-blue-lt text-blue';
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replaceAll('"', '""')}"`;
}

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function uniqueValues(values) {
  return Array.from(new Set(values.map(normalizeUpper).filter(Boolean))).sort();
}

function keyValue(value) {
  return String(value || '').trim().toUpperCase();
}

function customerDuplicateKey(data) {
  const key = [
    data.firstName,
    data.lastName,
    data.landmark,
    data.addressLine1,
    data.province,
    data.city,
    data.barangay,
    data.latitude,
    data.longitude
  ].map(keyValue).join('|');
  return key.replaceAll('|', '') ? key : '';
}

function rowNumbers(rows) {
  return rows.map((row) => row.rowNumber).join(', ');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  return rows;
}

function parseCustomerCsv(text, requiredHeaders, existingCustomers = []) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { headers: [], rows: [], fileErrors: ['CSV must include a header row and at least one customer row.'] };
  }

  const headers = rows[0].map((header) => String(header || '').trim());
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const fileErrors = requiredHeaders
    .filter((header) => !normalizedHeaders.includes(header.toLowerCase()))
    .map((header) => `Missing required header: ${header}`);

  const parsedRows = rows.slice(1).map((cells, index) => {
    const data = {};
    headers.forEach((header, cellIndex) => {
      if (header) data[header] = String(cells[cellIndex] || '').trim();
    });
    const hasData = Object.values(data).some((item) => String(item || '').trim());
    const rowErrors = requiredHeaders
      .filter((header) => !String(data[header] || '').trim())
      .map((header) => `${header} is required`);
    return {
      rowNumber: index + 2,
      hasData,
      data: {
        status: 'ACTIVE',
        customerType: 'RESIDENTIAL',
        ...data
      },
      errors: rowErrors
    };
  }).filter((item) => item.hasData);

  const existingAccounts = new Set(existingCustomers.map((customer) => keyValue(customer.accountNumber)).filter(Boolean));
  const existingCustomerKeys = new Set(existingCustomers.map(customerDuplicateKey).filter(Boolean));
  const accountRows = new Map();
  const customerKeyRows = new Map();

  parsedRows.forEach((row) => {
    const accountNumber = keyValue(row.data.accountNumber);
    const duplicateKey = customerDuplicateKey(row.data);
    if (accountNumber) accountRows.set(accountNumber, [...(accountRows.get(accountNumber) || []), row]);
    if (duplicateKey) customerKeyRows.set(duplicateKey, [...(customerKeyRows.get(duplicateKey) || []), row]);
  });

  parsedRows.forEach((row) => {
    const accountNumber = keyValue(row.data.accountNumber);
    const duplicateKey = customerDuplicateKey(row.data);
    const duplicateAccountRows = accountRows.get(accountNumber) || [];
    const duplicateCustomerRows = customerKeyRows.get(duplicateKey) || [];

    if (accountNumber && existingAccounts.has(accountNumber)) {
      row.errors.push(`Account number ${row.data.accountNumber} already exists`);
    }
    if (duplicateKey && existingCustomerKeys.has(duplicateKey)) {
      row.errors.push('Customer already exists with the same name and service address');
    }
    if (duplicateAccountRows.length > 1) {
      row.errors.push(`Duplicate account number in CSV rows ${rowNumbers(duplicateAccountRows)}`);
    }
    if (duplicateCustomerRows.length > 1) {
      row.errors.push(`Duplicate customer identity/address in CSV rows ${rowNumbers(duplicateCustomerRows)}`);
    }
  });

  return { headers, rows: parsedRows, fileErrors };
}

function locationLabel(location) {
  const parts = [
    location.location_name,
    location.barangay,
    location.municipality,
    location.province
  ].map((part) => String(part || '').trim()).filter(Boolean);
  return Array.from(new Set(parts)).join(' / ') || location.address || 'Unnamed location';
}

function formatCustomerAddress(customer) {
  return [
    customer.addressLine1,
    customer.addressLine2,
    customer.barangay,
    customer.city,
    customer.province
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || '-';
}

function formatCustomerLocation(customer) {
  return [
    customer.landmark,
    customer.barangay,
    customer.city
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || '-';
}

function formatCustomerResidence(customer) {
  return [
    customer.barangay,
    customer.city,
    customer.province
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || '-';
}

function formatDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${Number(dateOnly[2])}/${Number(dateOnly[3])}/${dateOnly[1]}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  }).format(parsed);
}

function formatRecommendedByCustomer(data = {}) {
  const name = String(data.recommendedByCustomerName || '').trim();
  const account = String(data.recommendedByCustomerAccountNumber || '').trim();
  if (account && name) return `${account} - ${name}`;
  return name || account || String(data.recommendedByCustomerId || '').trim() || '-';
}

function coordinateNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildStreetViewUrl(latitude, longitude) {
  return `https://maps.google.com/maps?q=&layer=c&cbll=${latitude},${longitude}&cbp=11,0,0,0,0&output=svembed`;
}

function lonToTileX(longitude, zoom) {
  return ((longitude + 180) / 360) * (2 ** zoom);
}

function latToTileY(latitude, zoom) {
  const latRad = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI) / 2) * (2 ** zoom);
}

function tileXToLon(tileX, zoom) {
  return (tileX / (2 ** zoom)) * 360 - 180;
}

function tileYToLat(tileY, zoom) {
  const value = Math.PI * (1 - (2 * tileY) / (2 ** zoom));
  return (Math.atan(Math.sinh(value)) * 180) / Math.PI;
}

function clampMapLatitude(latitude) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

function normalizeMapLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function coordinateTileData(centerLatitude, centerLongitude, selectedLatitude, selectedLongitude, zoom = COORDINATE_CAPTURE_ZOOM, provider = null) {
  const centerX = lonToTileX(centerLongitude, zoom);
  const centerY = latToTileY(centerLatitude, zoom);
  const baseX = Math.floor(centerX) - 1;
  const baseY = Math.floor(centerY) - 1;
  const tileProvider = provider || defaultMapProvider();
  const tileProviderId = tileProvider?.id || 'map';
  const tiles = [];
  for (let row = 0; row < MAP_TILE_COUNT; row += 1) {
    for (let column = 0; column < MAP_TILE_COUNT; column += 1) {
      const x = baseX + column;
      const y = baseY + row;
      const url = mapProviderTileUrl(tileProvider, x, y, zoom);
      if (!url) continue;
      tiles.push({
        key: `${tileProviderId}-${zoom}-${x}-${y}`,
        url
      });
    }
  }
  const markerX = (lonToTileX(selectedLongitude, zoom) - baseX) * MAP_TILE_SIZE;
  const markerY = (latToTileY(selectedLatitude, zoom) - baseY) * MAP_TILE_SIZE;
  const mapSize = MAP_TILE_SIZE * MAP_TILE_COUNT;
  return {
    baseX,
    baseY,
    mapSize,
    tiles,
    marker: {
      left: `${(markerX / mapSize) * 100}%`,
      top: `${(markerY / mapSize) * 100}%`
    }
  };
}

function customerCoordinates(customer) {
  const latitude = coordinateNumber(customer?.latitude);
  const longitude = coordinateNumber(customer?.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function googleMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function formatDraftDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function Card({ title, icon: Icon, children, actions, className = '' }) {
  return (
    <div className={`card ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-header">
          <h3 className="card-title">
            {Icon && <Icon size={18} className="me-2 text-muted" />}
            {title}
          </h3>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

const blankCustomerForm = {
  accountNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  businessName: '',
  birthDate: '',
  recommendedByCustomer: false,
  recommendedByCustomerId: '',
  recommendedByCustomerAccountNumber: '',
  recommendedByCustomerName: '',
  contactNumber: '',
  alternateMobileNumber: '',
  facebookAccountName: '',
  facebookProfileLink: '',
  secondaryContactName: '',
  secondaryContactNumber: '',
  secondaryContactFacebookAccount: '',
  secondaryContactRelationship: '',
  email: '',
  locationId: '',
  locationName: '',
  landmark: '',
  addressLine1: '',
  addressLine2: '',
  province: 'CAGAYAN',
  city: 'ENRILE',
  barangay: 'ALIBAGO',
  latitude: '',
  longitude: '',
  gender: 'MALE',
  customerType: 'RESIDENTIAL',
  status: 'PENDING'
};

const blankCustomerFilters = {
  search: '',
  customerType: '',
  status: '',
  province: '',
  city: '',
  barangay: '',
  sortBy: 'createdAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 10
};

const customerTableColumns = [
  { key: 'name', label: 'Name', sortBy: 'fullName', group: 'Profile' },
  { key: 'account', label: 'Account', sortBy: 'accountNumber', group: 'Profile' },
  { key: 'status', label: 'Status', sortBy: 'status', group: 'Profile' },
  { key: 'type', label: 'Type', sortBy: 'customerType', group: 'Profile' },
  { key: 'businessName', label: 'Business Name', sortBy: 'businessName', group: 'Profile', defaultVisible: false },
  { key: 'birthDate', label: 'Birth Date', sortBy: 'birthDate', group: 'Profile', defaultVisible: false },
  { key: 'recommendedByCustomerName', label: 'Recommended By', sortBy: 'recommendedByCustomerName', group: 'Profile', defaultVisible: false },
  { key: 'contact', label: 'Primary Contact', sortBy: 'contactNumber', group: 'Contact' },
  { key: 'alternateMobileNumber', label: 'Alternate Mobile', sortBy: 'alternateMobileNumber', group: 'Contact', defaultVisible: false },
  { key: 'facebookAccountName', label: 'Facebook', sortBy: 'facebookAccountName', group: 'Contact', defaultVisible: false },
  { key: 'facebookProfileLink', label: 'Facebook Link', sortBy: 'facebookProfileLink', group: 'Contact', defaultVisible: false },
  { key: 'email', label: 'Email', sortBy: 'email', group: 'Contact', defaultVisible: false },
  { key: 'secondaryContacts', label: 'Secondary Contacts', sortBy: 'secondaryContacts', group: 'Contact', defaultVisible: false },
  { key: 'residence', label: 'Lives In', sortBy: 'address', group: 'Location', defaultVisible: false },
  { key: 'locationName', label: 'Customer Location', sortBy: 'locationName', group: 'Location', defaultVisible: false },
  { key: 'landmark', label: 'Landmark', sortBy: 'landmark', group: 'Location', defaultVisible: false },
  { key: 'address', label: 'Address', sortBy: 'address', group: 'Location' },
  { key: 'province', label: 'Province', sortBy: 'province', group: 'Location', defaultVisible: false },
  { key: 'city', label: 'City', sortBy: 'city', group: 'Location', defaultVisible: false },
  { key: 'barangay', label: 'Barangay', sortBy: 'barangay', group: 'Location', defaultVisible: false },
  { key: 'coordinates', label: 'Coordinates', sortBy: 'coordinates', group: 'Location', defaultVisible: false },
  { key: 'longitude', label: 'Longitude', sortBy: 'longitude', group: 'Location', defaultVisible: false },
  { key: 'latitude', label: 'Latitude', sortBy: 'latitude', group: 'Location', defaultVisible: false }
];

const defaultCustomerTableColumnVisibility = customerTableColumns.reduce((columns, column) => ({
  ...columns,
  [column.key]: column.defaultVisible !== false
}), {});

const customerTableColumnGroups = Array.from(new Set(customerTableColumns.map((column) => column.group)));

const customerFormStages = [
  { title: 'Profile', description: 'Account identity and lifecycle' },
  { title: 'Contact', description: 'Customer and relative contact information' },
  { title: 'Location', description: 'Service address and coordinates' },
  { title: 'Review', description: 'Confirm before saving' }
];

const customerFormStageIcons = [IconUser, IconAddressBook, IconMapPin, IconClipboardCheck];

const customerDraftFields = Object.keys(blankCustomerForm);

function hasCustomerDraftData(data) {
  return customerDraftFields.some((key) => String(data?.[key] ?? '').trim() !== String(blankCustomerForm[key] ?? '').trim());
}

function customerFieldChanged(data, key) {
  return String(data?.[key] ?? '').trim() !== String(blankCustomerForm[key] ?? '').trim();
}

function customerStageCompleted(data, stageIndex) {
  if (stageIndex === 0) {
    const requiredFields = ['firstName', 'lastName'];
    if (normalizeUpper(data?.customerType) === 'BUSINESS') requiredFields.push('businessName');
    if (data?.recommendedByCustomer) requiredFields.push('recommendedByCustomerId');
    return requiredFields.every((key) => String(data?.[key] || '').trim());
  }
  if (stageIndex === 1) {
    return Boolean(String(data?.contactNumber || '').trim());
  }
  if (stageIndex === 2) {
    return [
      'locationId',
      'locationName',
      'landmark',
      'addressLine1',
      'addressLine2',
      'province',
      'city',
      'barangay',
      'latitude',
      'longitude'
    ].some((key) => customerFieldChanged(data, key));
  }
  const requiredFields = ['firstName', 'lastName', 'contactNumber'];
  if (normalizeUpper(data?.customerType) === 'BUSINESS') requiredFields.push('businessName');
  if (data?.recommendedByCustomer) requiredFields.push('recommendedByCustomerId');
  return requiredFields.every((key) => String(data?.[key] || '').trim());
}

function draftTitle(draft) {
  const form = draft?.form || {};
  const name = [form.firstName, form.middleName, form.lastName].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
  return name || form.accountNumber || form.contactNumber || 'Untitled customer draft';
}

function readCustomerDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOMER_DRAFT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCustomerTableColumns(value) {
  return customerTableColumns.reduce((columns, column) => ({
    ...columns,
    [column.key]: value?.[column.key] !== undefined
      ? value[column.key] !== false
      : defaultCustomerTableColumnVisibility[column.key]
  }), {});
}

function customerColumnStatusKey(statusValue) {
  return statusValue || 'ALL';
}

function customerColumnUserKey(user) {
  return encodeURIComponent(String(user?.id || user?.username || 'local'));
}

function customerColumnStorageKey(userKey, statusValue) {
  return `${CUSTOMER_TABLE_COLUMN_STORAGE_PREFIX}:${userKey || 'local'}:${customerColumnStatusKey(statusValue)}`;
}

function readCustomerTableColumns(userKey = 'local', statusValue = '') {
  try {
    const scoped = localStorage.getItem(customerColumnStorageKey(userKey, statusValue));
    if (scoped) return normalizeCustomerTableColumns(JSON.parse(scoped));
    const legacy = localStorage.getItem(CUSTOMER_TABLE_COLUMN_STORAGE_PREFIX);
    if (legacy) return normalizeCustomerTableColumns(JSON.parse(legacy));
    return normalizeCustomerTableColumns({});
  } catch {
    return normalizeCustomerTableColumns({});
  }
}

export default function CustomerProfilingPage({ refreshShell = () => {} }) {
  const [overview, setOverview] = useState(null);
  const [meta, setMeta] = useState({ customerTypes: [], customerStatuses: [], customerGenders: [], provinces: [], cities: [], citiesByProvince: {}, barangays: [], barangaysByProvinceCity: {}, bulkUploadHeaders: [] });
  const [locations, setLocations] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [mapProviderSettings, setMapProviderSettings] = useState(normalizeMapProviderSettings());
  const [customerMapProviderId, setCustomerMapProviderId] = useState('');
  const [customerMapProviderSession, setCustomerMapProviderSession] = useState(null);
  const [customerMapProviderSessionError, setCustomerMapProviderSessionError] = useState('');
  const [customers, setCustomers] = useState({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState(blankCustomerFilters);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blankCustomerForm);
  const [editingId, setEditingId] = useState('');
  const [isFormModalOpen, setFormModalOpen] = useState(false);
  const [isBulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [bulkUploadFileName, setBulkUploadFileName] = useState('');
  const [bulkUploadRows, setBulkUploadRows] = useState([]);
  const [bulkUploadFileErrors, setBulkUploadFileErrors] = useState([]);
  const [bulkUploadResult, setBulkUploadResult] = useState(null);
  const [isBulkUploading, setBulkUploading] = useState(false);
  const [isDetailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [customerDetailTab, setCustomerDetailTab] = useState('basic');
  const [areFiltersOpen, setFiltersOpen] = useState(false);
  const [formStage, setFormStage] = useState(0);
  const [customerDrafts, setCustomerDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [isDraftPanelOpen, setDraftPanelOpen] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [coordinateCapture, setCoordinateCapture] = useState(null);
  const [coordinatePan, setCoordinatePan] = useState(null);
  const [locationSearch, setLocationSearch] = useState('');
  const [isLocationPickerOpen, setLocationPickerOpen] = useState(false);
  const [referralSearch, setReferralSearch] = useState('');
  const [referralOptions, setReferralOptions] = useState([]);
  const [isReferralPickerOpen, setReferralPickerOpen] = useState(false);
  const [isMobileDetailsView, setMobileDetailsView] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches
  ));
  const [visibleCustomerColumns, setVisibleCustomerColumns] = useState(readCustomerTableColumns);
  const [columnPreferenceUserKey, setColumnPreferenceUserKey] = useState('local');
  const [isColumnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnMenuPosition, setColumnMenuPosition] = useState({ top: 0, left: 0, width: CUSTOMER_COLUMN_MENU_WIDTH, maxHeight: 360 });
  const [columnMenuSearch, setColumnMenuSearch] = useState('');
  const [openCustomerActionMenuId, setOpenCustomerActionMenuId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const coordinateDragMovedRef = useRef(false);
  const columnMenuButtonRef = useRef(null);
  const latestFiltersRef = useRef(blankCustomerFilters);
  const searchDebounceRef = useRef(null);
  const referralSearchDebounceRef = useRef(null);

  const savedProvinces = uniqueValues(locations.map((location) => normalizeUpper(location.province)));
  const provinceOptions = uniqueValues([...savedProvinces, ...(meta.provinces || [])]);
  const savedCities = uniqueValues(locations
    .filter((location) => !filters.province || normalizeUpper(location.province) === normalizeUpper(filters.province))
    .map((location) => normalizeUpper(location.municipality)));
  const formSavedCities = uniqueValues(locations
    .filter((location) => !form.province || normalizeUpper(location.province) === normalizeUpper(form.province))
    .map((location) => normalizeUpper(location.municipality)));
  const cities = filters.province ? uniqueValues([...(meta.citiesByProvince?.[filters.province] || []), ...savedCities]) : uniqueValues([...(meta.cities || []), ...savedCities]);
  const formCities = form.province ? uniqueValues([...(meta.citiesByProvince?.[form.province] || []), ...formSavedCities]) : uniqueValues([...(meta.cities || []), ...formSavedCities]);
  const barangayKey = `${filters.province}::${filters.city}`;
  const formBarangayKey = `${form.province}::${form.city}`;
  const savedBarangays = uniqueValues(locations
    .filter((location) => (!filters.province || normalizeUpper(location.province) === normalizeUpper(filters.province))
      && (!filters.city || normalizeUpper(location.municipality) === normalizeUpper(filters.city)))
    .map((location) => normalizeUpper(location.barangay)));
  const formSavedBarangays = uniqueValues(locations
    .filter((location) => (!form.province || normalizeUpper(location.province) === normalizeUpper(form.province))
      && (!form.city || normalizeUpper(location.municipality) === normalizeUpper(form.city)))
    .map((location) => normalizeUpper(location.barangay)));
  const barangays = filters.province && filters.city ? uniqueValues([...(meta.barangaysByProvinceCity?.[barangayKey] || []), ...savedBarangays]) : uniqueValues([...(meta.barangays || []), ...savedBarangays]);
  const formBarangays = form.province && form.city ? uniqueValues([...(meta.barangaysByProvinceCity?.[formBarangayKey] || []), ...formSavedBarangays]) : uniqueValues([...(meta.barangays || []), ...formSavedBarangays]);
  const requiredBulkUploadHeaders = meta.requiredBulkUploadHeaders || ['firstName', 'lastName', 'contactNumber'];
  const validBulkUploadRows = bulkUploadRows.filter((row) => !row.errors.length);
  const invalidBulkUploadRows = bulkUploadRows.filter((row) => row.errors.length);
  const hasActiveTableFilters = ['search', 'customerType', 'status', 'province', 'city', 'barangay'].some((key) => Boolean(filters[key]));
  const lastFormStage = customerFormStages.length - 1;
  const hasFormDraftData = hasCustomerDraftData(form);
  const isEditingCustomer = Boolean(editingId);
  const completedFormStages = customerFormStages.map((_, index) => customerStageCompleted(form, index));
  const displayedCompletedFormStages = completedFormStages.map((completed, index) => (
    index === lastFormStage ? completed && formStage === lastFormStage : completed
  ));
  const customerWizardProgress = Math.round((displayedCompletedFormStages.filter(Boolean).length / customerFormStages.length) * 100);
  const selectedFormLocation = locations.find((item) => item.id === form.locationId);
  const canCaptureCoordinates = Boolean(selectedFormLocation);
  const hasCoordinateValues = Boolean(String(form.longitude || '').trim() || String(form.latitude || '').trim());
  const locationSearchQuery = locationSearch.trim().toLowerCase();
  const filteredLocationRecords = locations
    .filter((location) => {
      if (!locationSearchQuery) return true;
      return [
        locationLabel(location),
        location.address,
        location.location_name,
        location.barangay,
        location.municipality,
        location.province
      ].some((part) => String(part || '').toLowerCase().includes(locationSearchQuery));
    })
    .slice(0, 12);
  const filteredReferralOptions = referralOptions.filter((customer) => customer.id !== editingId);
  const customerMapProviderOptions = enabledMapProviders(mapProviderSettings);
  const customerMapProvider = mapProviderById(mapProviderSettings, customerMapProviderId) || defaultMapProvider(mapProviderSettings);
  const activeCustomerMapProvider = mapProviderWithSession(customerMapProvider, customerMapProviderSession);
  const coordinateCaptureMaxZoom = Math.max(COORDINATE_CAPTURE_MIN_ZOOM, Number(customerMapProvider?.maxZoom) || COORDINATE_CAPTURE_MAX_ZOOM);
  const coordinateMap = coordinateCapture
    ? coordinateTileData(
      coordinateCapture.centerLatitude,
      coordinateCapture.centerLongitude,
      coordinateCapture.selectedLatitude,
      coordinateCapture.selectedLongitude,
      coordinateCapture.zoom,
      activeCustomerMapProvider
    )
    : null;
  const statusTabs = [
    { label: 'All', value: '', count: overview?.totalCustomers ?? 0, tone: 'blue' },
    { label: 'Active', value: 'ACTIVE', count: overview?.activeCustomers ?? 0, tone: 'green' },
    { label: 'Pending', value: 'PENDING', count: overview?.pendingCustomers ?? 0, tone: 'yellow' },
    { label: 'Suspended', value: 'SUSPENDED', count: overview?.suspendedCustomers ?? 0, tone: 'red' },
    {
      label: 'Inactive',
      value: 'INACTIVE',
      count: Math.max(
        0,
        (overview?.totalCustomers ?? 0)
          - (overview?.activeCustomers ?? 0)
          - (overview?.pendingCustomers ?? 0)
          - (overview?.suspendedCustomers ?? 0)
      ),
      tone: 'secondary'
    }
  ];
  const customerDetailTabs = [
    { label: 'Basic Info', value: 'basic' },
    { label: 'Location', value: 'location' }
  ];
  const activeColumnPreferenceLabel = statusTabs.find((item) => item.value === filters.status)?.label || 'All';
  const activeColumnPreferenceStorageKey = customerColumnStorageKey(columnPreferenceUserKey, filters.status);
  const columnMenuSearchQuery = columnMenuSearch.trim().toLowerCase();
  const filteredCustomerTableColumnGroups = customerTableColumnGroups
    .map((group) => ({
      group,
      columns: customerTableColumns.filter((column) => (
        column.group === group
        && (!columnMenuSearchQuery || [column.label, column.key, column.group]
          .some((part) => String(part || '').toLowerCase().includes(columnMenuSearchQuery)))
      ))
    }))
    .filter((item) => item.columns.length);
  const activeCustomerColumns = customerTableColumns.filter((column) => visibleCustomerColumns[column.key]);
  const visibleCustomerColumnCount = activeCustomerColumns.length;

  async function load(nextFilters = filters) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== '') params.set(key, value);
    });
    try {
      const [nextOverview, nextCustomers, nextMeta, nextLocations, nextAvatarConfig, nextMapProviders] = await Promise.all([
        request('/customer-profiling/customers/overview'),
        request(`/customer-profiling/customers?${params.toString()}`),
        request('/customer-profiling/meta'),
        request('/system-settings/locations').catch(() => []),
        request('/system-settings/avatars').catch(() => null),
        request('/system-settings/map-providers').catch(() => null)
      ]);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setMeta(nextMeta);
      setLocations(Array.isArray(nextLocations) ? nextLocations : []);
      setAvatarConfig(nextAvatarConfig);
      setMapProviderSettings(normalizeMapProviderSettings(nextMapProviders || undefined));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCustomer(id) {
    setError('');
    try {
      const customer = await request(`/customer-profiling/customers/${id}`);
      setSelected(customer);
      setCustomerDetailTab('basic');
      setDetailsPanelOpen(true);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    let cancelled = false;
    request('/me')
      .then((user) => {
        if (!cancelled) setColumnPreferenceUserKey(customerColumnUserKey(user));
      })
      .catch(() => {
        if (!cancelled) setColumnPreferenceUserKey('local');
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    latestFiltersRef.current = filters;
  }, [filters]);
  useEffect(() => {
    setVisibleCustomerColumns(readCustomerTableColumns(columnPreferenceUserKey, filters.status));
  }, [columnPreferenceUserKey, filters.status]);
  useEffect(() => { setCustomerDrafts(readCustomerDrafts()); }, []);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767.98px)');
    const syncMobileDetails = () => setMobileDetailsView(mediaQuery.matches);
    syncMobileDetails();
    mediaQuery.addEventListener?.('change', syncMobileDetails);
    return () => mediaQuery.removeEventListener?.('change', syncMobileDetails);
  }, []);
  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useEffect(() => () => {
    window.clearTimeout(searchDebounceRef.current);
    window.clearTimeout(referralSearchDebounceRef.current);
  }, []);
  useEffect(() => {
    if (!isColumnMenuOpen) return undefined;
    syncColumnMenuPosition();
    const handleReposition = () => syncColumnMenuPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isColumnMenuOpen]);
  useEffect(() => {
    let cancelled = false;
    setCustomerMapProviderSession(null);
    setCustomerMapProviderSessionError('');
    if (!mapProviderNeedsSession(customerMapProvider)) return undefined;
    createMapProviderSession(customerMapProvider)
      .then((session) => {
        if (!cancelled) setCustomerMapProviderSession(session);
      })
      .catch((err) => {
        if (!cancelled) setCustomerMapProviderSessionError(err.message || 'Map provider session failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [
    customerMapProvider?.id,
    customerMapProvider?.apiKey,
    customerMapProvider?.sessionProvider,
    customerMapProvider?.googleMapType,
    customerMapProvider?.googleLanguage,
    customerMapProvider?.googleRegion
  ]);

  function updateFilters(next) {
    const merged = { ...latestFiltersRef.current, ...next, page: 1 };
    latestFiltersRef.current = merged;
    setFilters(merged);
    load(merged);
  }

  function handleSearchChange(value) {
    const merged = { ...latestFiltersRef.current, search: value, page: 1 };
    latestFiltersRef.current = merged;
    setFilters(merged);
    window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      load(latestFiltersRef.current);
    }, 350);
  }

  function submitSearch() {
    window.clearTimeout(searchDebounceRef.current);
    load(latestFiltersRef.current);
  }

  function clearSearch() {
    window.clearTimeout(searchDebounceRef.current);
    updateFilters({ search: '' });
  }

  function syncColumnMenuPosition() {
    if (!columnMenuButtonRef.current || typeof window === 'undefined') return;
    const rect = columnMenuButtonRef.current.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(CUSTOMER_COLUMN_MENU_WIDTH, window.innerWidth - (viewportPadding * 2));
    const left = Math.max(
      viewportPadding,
      Math.min(window.innerWidth - width - viewportPadding, rect.right - width)
    );
    const top = Math.min(rect.bottom + 8, Math.max(viewportPadding, window.innerHeight - 180));
    setColumnMenuPosition({
      top,
      left,
      width,
      maxHeight: Math.max(180, window.innerHeight - top - viewportPadding)
    });
  }

  function toggleColumnMenu() {
    setColumnMenuOpen((value) => {
      const nextValue = !value;
      if (nextValue) {
        syncColumnMenuPosition();
        window.requestAnimationFrame(syncColumnMenuPosition);
      }
      return nextValue;
    });
  }

  function toggleSort(sortBy) {
    const nextDirection = filters.sortBy === sortBy && filters.sortDir === 'asc' ? 'desc' : 'asc';
    updateFilters({ sortBy, sortDir: nextDirection });
  }

  function toggleCustomerColumn(columnKey) {
    setVisibleCustomerColumns((current) => {
      const currentlyVisible = current[columnKey] !== false;
      const visibleCount = customerTableColumns.filter((column) => current[column.key] !== false).length;
      if (currentlyVisible && visibleCount <= 1) return current;
      const nextColumns = { ...current, [columnKey]: !currentlyVisible };
      localStorage.setItem(activeColumnPreferenceStorageKey, JSON.stringify(nextColumns));
      return nextColumns;
    });
  }

  function handleFilterButtonClick() {
    if (areFiltersOpen && hasActiveTableFilters) {
      const resetFilters = { ...blankCustomerFilters, pageSize: filters.pageSize };
      latestFiltersRef.current = resetFilters;
      setFilters(resetFilters);
      setFiltersOpen(false);
      load(resetFilters);
      return;
    }
    setFiltersOpen((value) => !value);
  }

  function persistCustomerDrafts(nextDrafts) {
    setCustomerDrafts(nextDrafts);
    localStorage.setItem(CUSTOMER_DRAFT_STORAGE_KEY, JSON.stringify(nextDrafts));
  }

  function removeDrafts(ids) {
    const idSet = new Set(ids);
    const nextDrafts = customerDrafts.filter((draft) => !idSet.has(draft.id));
    persistCustomerDrafts(nextDrafts);
    setSelectedDraftIds((current) => current.filter((id) => !idSet.has(id)));
    if (idSet.has(activeDraftId)) setActiveDraftId('');
  }

  function saveCurrentDraft({ silent = false } = {}) {
    if (editingId || !hasFormDraftData) return false;
    const now = new Date().toISOString();
    const existing = customerDrafts.find((draft) => draft.id === activeDraftId);
    const draft = {
      id: activeDraftId || `customer-draft-${Date.now()}`,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      stage: formStage,
      form: { ...blankCustomerForm, ...form }
    };
    const nextDrafts = [draft, ...customerDrafts.filter((item) => item.id !== draft.id)]
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    persistCustomerDrafts(nextDrafts);
    setActiveDraftId(draft.id);
    if (!silent) setMessage(`Draft saved for ${draftTitle(draft)}.`);
    return true;
  }

  function openDraftPanel() {
    setDraftPanelOpen(true);
    setDetailsPanelOpen(false);
  }

  function closeDraftPanel() {
    setDraftPanelOpen(false);
    setSelectedDraftIds([]);
  }

  function resetReferralPicker() {
    window.clearTimeout(referralSearchDebounceRef.current);
    setReferralSearch('');
    setReferralOptions([]);
    setReferralPickerOpen(false);
  }

  function continueDraft(draft) {
    const draftForm = { ...blankCustomerForm, ...(draft.form || {}) };
    const draftLocation = locations.find((location) => location.id === draftForm.locationId);
    setEditingId('');
    setActiveDraftId(draft.id);
    setForm(draftForm);
    setLocationSearch(draftLocation ? locationLabel(draftLocation) : draftForm.locationName || '');
    setReferralSearch(draftForm.recommendedByCustomer ? formatRecommendedByCustomer(draftForm) : '');
    setReferralOptions([]);
    setReferralPickerOpen(false);
    setLocationPickerOpen(false);
    setFormStage(Math.min(Math.max(Number(draft.stage) || 0, 0), lastFormStage));
    setFormModalOpen(true);
    setDraftPanelOpen(false);
    setMessage(`Continuing ${draftTitle(draft)}.`);
    setError('');
  }

  function toggleDraftSelection(draftId) {
    setSelectedDraftIds((current) => (
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    ));
  }

  function editCustomer(customer) {
    const firstSecondary = customer.secondaryContacts?.[0] || {};
    const customerLocation = locations.find((location) => location.id === customer.locationId);
    const nextForm = {
      ...blankCustomerForm,
      ...customer,
      landmark: customer.landmark || customer.locationName || '',
      secondaryContactName: customer.secondaryContactName || firstSecondary.name || '',
      secondaryContactNumber: customer.secondaryContactNumber || firstSecondary.contactNumber || '',
      secondaryContactFacebookAccount: customer.secondaryContactFacebookAccount || firstSecondary.facebookAccount || '',
      secondaryContactRelationship: customer.secondaryContactRelationship || firstSecondary.relationship || ''
    };
    setEditingId(customer.id);
    setActiveDraftId('');
    setFormStage(0);
    setLocationSearch(customerLocation ? locationLabel(customerLocation) : customer.locationName || '');
    setReferralSearch(nextForm.recommendedByCustomer ? formatRecommendedByCustomer(nextForm) : '');
    setReferralOptions([]);
    setReferralPickerOpen(false);
    setLocationPickerOpen(false);
    setForm(nextForm);
    setFormModalOpen(true);
    setMessage(`Editing ${customer.accountNumber}`);
  }

  function openNewCustomerModal() {
    setEditingId('');
    setActiveDraftId('');
    setFormStage(0);
    setLocationSearch('');
    resetReferralPicker();
    setLocationPickerOpen(false);
    setForm({ ...blankCustomerForm });
    setFormModalOpen(true);
    setMessage('');
    setError('');
  }

  function closeCustomerFormModal() {
    const savedDraft = saveCurrentDraft({ silent: true });
    setFormModalOpen(false);
    setEditingId('');
    setActiveDraftId('');
    setFormStage(0);
    setLocationSearch('');
    resetReferralPicker();
    setLocationPickerOpen(false);
    setForm({ ...blankCustomerForm });
    if (savedDraft) setMessage('Customer draft saved. Open Drafts to continue later.');
  }

  function openBulkUploadModal() {
    setBulkUploadModalOpen(true);
    setBulkUploadFileName('');
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadResult(null);
    setMessage('');
    setError('');
  }

  function closeBulkUploadModal() {
    setBulkUploadModalOpen(false);
    setBulkUploadFileName('');
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadResult(null);
  }

  function closeDetailsPanel() {
    setDetailsPanelOpen(false);
    setSelected(null);
    setCustomerDetailTab('basic');
  }

  function viewCustomer(customer) {
    if (!customer?.id) return;
    loadCustomer(customer.id);
  }

  function checkCustomerServiceability(customer) {
    if (!customer?.id) return;
    window.location.assign(`/network-settings/serviceability-check?customerId=${encodeURIComponent(customer.id)}`);
  }

  function handleCustomerRowClick(event, customer) {
    if (event.target.closest?.('button, a, input, label, select, textarea')) return;
    viewCustomer(customer);
  }

  function handleCustomerRowKeyDown(event, customer) {
    if (event.target.closest?.('button, a, input, label, select, textarea')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    viewCustomer(customer);
  }

  function resetForm() {
    setEditingId('');
    setActiveDraftId('');
    setFormStage(0);
    setLocationSearch('');
    resetReferralPicker();
    setLocationPickerOpen(false);
    setForm({ ...blankCustomerForm });
  }

  function canOpenCustomerFormStage(index) {
    const stageIndex = Number(index);
    return Number.isInteger(stageIndex) && stageIndex >= 0 && stageIndex <= lastFormStage;
  }

  function goToCustomerFormStage(index) {
    if (canOpenCustomerFormStage(index)) setFormStage(Math.min(Math.max(index, 0), lastFormStage));
  }

  function previousCustomerFormStage() {
    setFormStage((stage) => Math.max(0, stage - 1));
  }

  function nextCustomerFormStage(event) {
    event?.preventDefault();
    event?.stopPropagation();
    setFormStage((stage) => {
      const nextStage = Math.min(lastFormStage, stage + 1);
      return canOpenCustomerFormStage(nextStage) ? nextStage : stage;
    });
  }

  function applyLocation(locationId) {
    const location = locations.find((item) => item.id === locationId);
    if (!location) {
      setForm({ ...form, locationId: '', locationName: '' });
      setLocationSearch('');
      setLocationPickerOpen(false);
      return;
    }
    setForm({
      ...form,
      locationId: location.id,
      locationName: location.location_name || '',
      landmark: form.landmark || location.location_name || '',
      addressLine1: location.address || form.addressLine1 || '',
      province: normalizeUpper(location.province) || form.province || '',
      city: normalizeUpper(location.municipality) || form.city || '',
      barangay: normalizeUpper(location.barangay) || form.barangay || '',
      latitude: location.latitude ?? form.latitude ?? '',
      longitude: location.longitude ?? form.longitude ?? ''
    });
    setLocationSearch(locationLabel(location));
    setLocationPickerOpen(false);
  }

  function handleLocationSearchChange(value) {
    const selectedLabel = selectedFormLocation ? locationLabel(selectedFormLocation) : form.locationName || '';
    setLocationSearch(value);
    setLocationPickerOpen(true);
    if (!value.trim() || value.trim() !== selectedLabel) setForm({ ...form, locationId: '', locationName: '' });
  }

  function handleLocationSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setLocationPickerOpen(false);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (filteredLocationRecords[0]) applyLocation(filteredLocationRecords[0].id);
  }

  async function loadReferralOptions(searchValue = '') {
    const params = new URLSearchParams({
      page: '1',
      pageSize: '12',
      sortBy: 'fullName',
      sortDir: 'asc'
    });
    if (searchValue.trim()) params.set('search', searchValue.trim());
    try {
      const result = await request(`/customer-profiling/customers?${params.toString()}`);
      setReferralOptions(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err.message);
      setReferralOptions([]);
    }
  }

  function handleReferralToggle(checked) {
    setForm((current) => ({
      ...current,
      recommendedByCustomer: checked,
      recommendedByCustomerId: '',
      recommendedByCustomerAccountNumber: '',
      recommendedByCustomerName: ''
    }));
    setReferralSearch('');
    setReferralOptions([]);
    setReferralPickerOpen(checked);
    if (checked) loadReferralOptions('');
  }

  function handleReferralSearchChange(value) {
    setReferralSearch(value);
    setReferralPickerOpen(true);
    setForm((current) => ({
      ...current,
      recommendedByCustomerId: '',
      recommendedByCustomerAccountNumber: '',
      recommendedByCustomerName: ''
    }));
    window.clearTimeout(referralSearchDebounceRef.current);
    referralSearchDebounceRef.current = window.setTimeout(() => {
      loadReferralOptions(value);
    }, 250);
  }

  function applyReferralCustomer(customer) {
    setForm((current) => ({
      ...current,
      recommendedByCustomer: true,
      recommendedByCustomerId: customer.id,
      recommendedByCustomerAccountNumber: customer.accountNumber || '',
      recommendedByCustomerName: customer.fullName || [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(' ')
    }));
    setReferralSearch(formatRecommendedByCustomer({
      recommendedByCustomerId: customer.id,
      recommendedByCustomerAccountNumber: customer.accountNumber,
      recommendedByCustomerName: customer.fullName || [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(' ')
    }));
    setReferralPickerOpen(false);
  }

  function openCoordinateCapture() {
    if (!selectedFormLocation) return;
    const recordLatitude = coordinateNumber(selectedFormLocation.latitude);
    const recordLongitude = coordinateNumber(selectedFormLocation.longitude);
    const hasRecordCoordinates = recordLatitude !== null && recordLongitude !== null;
    const latitude = recordLatitude
      ?? coordinateNumber(form.latitude)
      ?? DEFAULT_CAPTURE_COORDINATES.latitude;
    const longitude = recordLongitude
      ?? coordinateNumber(form.longitude)
      ?? DEFAULT_CAPTURE_COORDINATES.longitude;
    setCoordinateCapture({
      centerLatitude: latitude,
      centerLongitude: longitude,
      originLatitude: latitude,
      originLongitude: longitude,
      selectedLatitude: latitude,
      selectedLongitude: longitude,
      zoom: COORDINATE_CAPTURE_ZOOM,
      streetViewEnabled: hasRecordCoordinates
    });
  }

  function selectCoordinateFromMapPoint(mapElement, clientX, clientY) {
    if (!coordinateCapture || !coordinateMap) return;
    const rect = mapElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * coordinateMap.mapSize;
    const y = ((clientY - rect.top) / rect.height) * coordinateMap.mapSize;
    const tileX = coordinateMap.baseX + (x / MAP_TILE_SIZE);
    const tileY = coordinateMap.baseY + (y / MAP_TILE_SIZE);
    setCoordinateCapture({
      ...coordinateCapture,
      selectedLatitude: tileYToLat(tileY, coordinateCapture.zoom),
      selectedLongitude: tileXToLon(tileX, coordinateCapture.zoom)
    });
  }

  function startCoordinatePan(event) {
    if (!coordinateCapture || !coordinateMap || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    coordinateDragMovedRef.current = false;
    setCoordinatePan({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerLatitude: coordinateCapture.centerLatitude,
      centerLongitude: coordinateCapture.centerLongitude,
      zoom: coordinateCapture.zoom
    });
  }

  function moveCoordinatePan(event) {
    if (!coordinatePan || coordinatePan.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = event.clientX - coordinatePan.startX;
    const deltaY = event.clientY - coordinatePan.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) coordinateDragMovedRef.current = true;

    const tileDeltaX = (deltaX / rect.width) * MAP_TILE_COUNT;
    const tileDeltaY = (deltaY / rect.height) * MAP_TILE_COUNT;
    const startTileX = lonToTileX(coordinatePan.centerLongitude, coordinatePan.zoom);
    const startTileY = latToTileY(coordinatePan.centerLatitude, coordinatePan.zoom);
    const maxTile = 2 ** coordinatePan.zoom;
    const nextTileY = Math.max(0, Math.min(maxTile, startTileY - tileDeltaY));

    setCoordinateCapture((current) => {
      if (!current) return current;
      return {
        ...current,
        centerLatitude: clampMapLatitude(tileYToLat(nextTileY, coordinatePan.zoom)),
        centerLongitude: normalizeMapLongitude(tileXToLon(startTileX - tileDeltaX, coordinatePan.zoom))
      };
    });
  }

  function finishCoordinatePan(event) {
    if (!coordinatePan || coordinatePan.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!coordinateDragMovedRef.current) {
      selectCoordinateFromMapPoint(event.currentTarget, event.clientX, event.clientY);
    }
    coordinateDragMovedRef.current = false;
    setCoordinatePan(null);
  }

  function handleCoordinateMapWheel(event) {
    event.preventDefault();
    if (!coordinateCapture) return;
    changeCoordinateZoom(event.deltaY < 0 ? 1 : -1);
  }

  function changeCoordinateZoom(delta) {
    setCoordinateCapture((current) => {
      if (!current) return current;
      const zoom = Math.min(coordinateCaptureMaxZoom, Math.max(COORDINATE_CAPTURE_MIN_ZOOM, current.zoom + delta));
      return {
        ...current,
        zoom,
        centerLatitude: current.selectedLatitude,
        centerLongitude: current.selectedLongitude
      };
    });
  }

  function recenterCoordinateCapture() {
    setCoordinateCapture((current) => {
      if (!current) return current;
      return {
        ...current,
        centerLatitude: current.originLatitude,
        centerLongitude: current.originLongitude,
        selectedLatitude: current.originLatitude,
        selectedLongitude: current.originLongitude
      };
    });
  }

  function applyCoordinateCapture() {
    if (!coordinateCapture) return;
    setForm({
      ...form,
      latitude: coordinateCapture.selectedLatitude.toFixed(6),
      longitude: coordinateCapture.selectedLongitude.toFixed(6)
    });
    setCoordinateCapture(null);
  }

  function clearCustomerCoordinates() {
    setForm({
      ...form,
      latitude: '',
      longitude: ''
    });
  }

  async function saveCustomer(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!editingId && formStage < lastFormStage) {
      nextCustomerFormStage();
      return;
    }
    const requiredFields = [
      ['firstName', 'First Name', 0],
      ['lastName', 'Last Name', 0],
      ['contactNumber', 'Contact Number', 1]
    ];
    if (normalizeUpper(form.customerType) === 'BUSINESS') {
      requiredFields.push(['businessName', 'Business Name', 0]);
    }
    if (form.recommendedByCustomer) {
      requiredFields.push(['recommendedByCustomerId', 'Recommended By Customer', 0]);
    }
    const missingField = requiredFields.find(([key]) => !String(form[key] || '').trim());
    if (missingField) {
      setFormStage(missingField[2]);
      setError(`${missingField[1]} is required before saving the customer.`);
      return;
    }
    const method = editingId ? 'PATCH' : 'POST';
    const path = editingId ? `/customer-profiling/customers/${editingId}` : '/customer-profiling/customers';
    const payload = { ...form };
    if (editingId) {
      delete payload.status;
    } else {
      payload.status = 'PENDING';
    }
    if (!payload.recommendedByCustomer) {
      payload.recommendedByCustomer = false;
      payload.recommendedByCustomerId = '';
      payload.recommendedByCustomerAccountNumber = '';
      payload.recommendedByCustomerName = '';
    }
    try {
      const saved = await request(path, { method, body: JSON.stringify(payload) });
      setMessage(`${saved.accountNumber} saved.`);
      const shouldRefreshOpenDetails = isDetailsPanelOpen && selected?.id === saved.id;
      if (activeDraftId) removeDrafts([activeDraftId]);
      setEditingId('');
      setActiveDraftId('');
      setFormStage(0);
      setForm({ ...blankCustomerForm });
      resetReferralPicker();
      setFormModalOpen(false);
      await load(filters);
      if (shouldRefreshOpenDetails) await loadCustomer(saved.id);
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCustomer(customer) {
    if (!window.confirm(`Archive ${customer.accountNumber} - ${customer.fullName}?`)) return;
    await request(`/customer-profiling/customers/${customer.id}`, { method: 'DELETE' });
    setMessage(`${customer.accountNumber} archived.`);
    if (selected?.id === customer.id) closeDetailsPanel();
    await load(filters);
    refreshShell();
  }

  async function downloadTemplate() {
    const template = await request('/customer-profiling/customers/bulk-upload-template');
    const csv = [
      template.headers.map(csvEscape).join(','),
      template.headers.map((header) => csvEscape(template.sample?.[header] || '')).join(',')
    ].join('\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = template.filename;
    link.click();
    URL.revokeObjectURL(href);
  }

  async function loadBulkUploadDuplicateCustomers() {
    const firstPage = await request('/customer-profiling/customers?page=1&pageSize=100&sortBy=createdAt&sortDir=desc');
    const rows = [...(firstPage.data || [])];
    const totalPages = firstPage.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await request(`/customer-profiling/customers?page=${page}&pageSize=100&sortBy=createdAt&sortDir=desc`);
      rows.push(...(nextPage.data || []));
    }
    return rows;
  }

  async function handleBulkUploadFile(event) {
    const file = event.target.files?.[0];
    setBulkUploadResult(null);
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadFileName(file?.name || '');
    if (!file) return;

    try {
      const [csvText, existingCustomers] = await Promise.all([
        file.text(),
        loadBulkUploadDuplicateCustomers()
      ]);
      const parsed = parseCustomerCsv(csvText, requiredBulkUploadHeaders, existingCustomers);
      setBulkUploadRows(parsed.rows);
      setBulkUploadFileErrors(parsed.fileErrors);
      if (!parsed.fileErrors.length && !parsed.rows.length) {
        setBulkUploadFileErrors(['No customer rows were found in the selected file.']);
      }
    } catch (err) {
      setBulkUploadFileErrors([err.message || 'Unable to read the selected CSV file.']);
    } finally {
      event.target.value = '';
    }
  }

  async function importBulkUploadRows() {
    const rowsToImport = validBulkUploadRows;
    if (!rowsToImport.length || bulkUploadFileErrors.length) return;

    setBulkUploading(true);
    setBulkUploadResult(null);
    setError('');

    const failures = [];
    let created = 0;
    for (const row of rowsToImport) {
      try {
        await request('/customer-profiling/customers', { method: 'POST', body: JSON.stringify(row.data) });
        created += 1;
      } catch (err) {
        failures.push({ rowNumber: row.rowNumber, message: err.message });
      }
    }

    setBulkUploading(false);
    setBulkUploadResult({ created, failed: failures.length, failures });
    if (created) {
      setMessage(`${created} customer${created === 1 ? '' : 's'} imported from ${bulkUploadFileName}.`);
      await load(filters);
      refreshShell();
    }
  }

  function renderReviewItem(label, value) {
    const renderedValue = String(value || '').trim() || '-';
    return (
      <div className="customer-review-item" key={label}>
        <span>{label}</span>
        <strong>{renderedValue}</strong>
      </div>
    );
  }

  function renderCustomerFormStage() {
    if (formStage === 0) {
      return (
        <div className="customer-stage-fields">
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Account Details</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Customer Type</label><select className="form-select" value={form.customerType || 'RESIDENTIAL'} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>{meta.customerTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="col-md-6"><label className="form-label">Gender</label><select className="form-select" value={form.gender || 'MALE'} onChange={(e) => setForm({ ...form, gender: e.target.value })}>{(meta.customerGenders || ['MALE', 'FEMALE']).map((item) => <option key={item}>{item}</option>)}</select></div>
              {normalizeUpper(form.customerType) === 'BUSINESS' && (
                <div className="col-md-12"><label className="form-label">Business Name</label><input className="form-control" value={form.businessName || ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Registered or trade name" /></div>
              )}
            </div>
          </section>
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Customer Name</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-4"><label className="form-label">First Name</label><input className="form-control" value={form.firstName || ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label">Middle Name</label><input className="form-control" value={form.middleName || ''} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label">Last Name</label><input className="form-control" value={form.lastName || ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label">Birth Date</label><input className="form-control" type="date" value={form.birthDate || ''} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></div>
            </div>
          </section>
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Referral</h5>
              <p>Track customer-to-customer recommendations.</p>
            </div>
            <div className="customer-referral-panel">
              <label className="form-check form-switch m-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={Boolean(form.recommendedByCustomer)}
                  onChange={(event) => handleReferralToggle(event.target.checked)}
                />
                <span className="form-check-label">Recommended by existing customer</span>
              </label>
              {form.recommendedByCustomer && (
                <div>
                  <label className="form-label">Recommended by customer</label>
                  <div className="customer-location-picker">
                    <IconSearch size={16} className="customer-location-search-icon" aria-hidden="true" />
                    <input
                      className="form-control customer-location-search-input"
                      value={referralSearch}
                      onChange={(event) => handleReferralSearchChange(event.target.value)}
                      onFocus={() => {
                        setReferralPickerOpen(true);
                        if (!referralOptions.length) loadReferralOptions(referralSearch);
                      }}
                      onBlur={() => window.setTimeout(() => setReferralPickerOpen(false), 120)}
                      placeholder="Search name, account, contact, or Facebook"
                      role="combobox"
                      aria-expanded={isReferralPickerOpen}
                      aria-controls="customer-referral-options"
                      aria-autocomplete="list"
                    />
                    {(form.recommendedByCustomerId || referralSearch) && (
                      <button
                        type="button"
                        className="btn btn-icon btn-sm customer-location-clear"
                        title="Clear recommended customer"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleReferralToggle(false)}
                      >
                        <IconX size={14} />
                      </button>
                    )}
                    {isReferralPickerOpen && (
                      <div className="customer-location-options" id="customer-referral-options" role="listbox">
                        {filteredReferralOptions.map((customer) => (
                          <button
                            type="button"
                            className={`customer-location-option ${form.recommendedByCustomerId === customer.id ? 'active' : ''}`}
                            key={customer.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyReferralCustomer(customer)}
                            role="option"
                            aria-selected={form.recommendedByCustomerId === customer.id}
                          >
                            <strong>{customer.accountNumber || 'No account'} - {customer.fullName}</strong>
                            <span>{[customer.contactNumber, customer.barangay, customer.city].filter(Boolean).join(' / ') || 'Existing customer'}</span>
                          </button>
                        ))}
                        {!filteredReferralOptions.length && (
                          <div className="customer-location-empty">No matching customer.</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="form-hint">Select the existing customer who recommended this profile.</div>
                </div>
              )}
            </div>
          </section>
        </div>
      );
    }
    if (formStage === 1) {
      return (
        <div className="customer-contact-stage">
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Primary Contact</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Contact Number</label><input className="form-control" value={form.contactNumber || ''} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Alternate Mobile</label><input className="form-control" value={form.alternateMobileNumber || ''} onChange={(e) => setForm({ ...form, alternateMobileNumber: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Facebook Account</label><input className="form-control" value={form.facebookAccountName || ''} onChange={(e) => setForm({ ...form, facebookAccountName: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Facebook Profile Link</label><input className="form-control" value={form.facebookProfileLink || ''} onChange={(e) => setForm({ ...form, facebookProfileLink: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Email</label><input className="form-control" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
          </section>
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Secondary Contact</h5>
              <p>Customer relative or emergency contact</p>
            </div>
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Relative Full Name</label><input className="form-control" value={form.secondaryContactName || ''} onChange={(e) => setForm({ ...form, secondaryContactName: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Relative Contact Number</label><input className="form-control" value={form.secondaryContactNumber || ''} onChange={(e) => setForm({ ...form, secondaryContactNumber: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Relative Facebook Account</label><input className="form-control" value={form.secondaryContactFacebookAccount || ''} onChange={(e) => setForm({ ...form, secondaryContactFacebookAccount: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Relationship to Customer</label><input className="form-control" value={form.secondaryContactRelationship || ''} onChange={(e) => setForm({ ...form, secondaryContactRelationship: e.target.value })} /></div>
            </div>
          </section>
        </div>
      );
    }
    if (formStage === 2) {
      return (
        <div className="customer-stage-fields">
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Customer Location</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-8">
                <label className="form-label">Customer Location Record</label>
                <div className="customer-location-picker">
                  <IconSearch size={16} className="customer-location-search-icon" aria-hidden="true" />
                  <input
                    className="form-control customer-location-search-input"
                    value={locationSearch}
                    onChange={(e) => handleLocationSearchChange(e.target.value)}
                    onFocus={() => setLocationPickerOpen(true)}
                    onBlur={() => window.setTimeout(() => setLocationPickerOpen(false), 120)}
                    onKeyDown={handleLocationSearchKeyDown}
                    placeholder="Search saved customer locations"
                    role="combobox"
                    aria-expanded={isLocationPickerOpen}
                    aria-controls="customer-location-options"
                    aria-autocomplete="list"
                  />
                  {(form.locationId || locationSearch) && (
                    <button
                      type="button"
                      className="btn btn-icon btn-sm customer-location-clear"
                      title="Clear customer location"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyLocation('')}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                  {isLocationPickerOpen && (
                    <div className="customer-location-options" id="customer-location-options" role="listbox">
                      <button
                        type="button"
                        className={`customer-location-option ${!form.locationId ? 'active' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyLocation('')}
                        role="option"
                        aria-selected={!form.locationId}
                      >
                        <strong>Manual / add on save</strong>
                        <span>Use the customer address below.</span>
                      </button>
                      {filteredLocationRecords.map((location) => (
                        <button
                          type="button"
                          className={`customer-location-option ${form.locationId === location.id ? 'active' : ''}`}
                          key={location.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyLocation(location.id)}
                          role="option"
                          aria-selected={form.locationId === location.id}
                        >
                          <strong>{locationLabel(location)}</strong>
                          <span>{location.address || [location.barangay, location.municipality, location.province].filter(Boolean).join(', ') || 'Saved customer location'}</span>
                        </button>
                      ))}
                      {!filteredLocationRecords.length && (
                        <div className="customer-location-empty">No matching customer location.</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-hint">Missing customer locations are added to System Settings for completion later.</div>
              </div>
              <div className="col-md-4"><label className="form-label">Landmark</label><input className="form-control" value={form.landmark || ''} onChange={(e) => setForm({ ...form, landmark: e.target.value })} placeholder="Nearest landmark or service-area note" /></div>
              <div className="col-md-4">
                <label className="form-label">Province</label>
                <input className="form-control" list="customer-province-options" value={form.province || ''} onChange={(e) => setForm({ ...form, province: normalizeUpper(e.target.value), city: '', barangay: '' })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">City</label>
                <input className="form-control" list="customer-city-options" value={form.city || ''} onChange={(e) => setForm({ ...form, city: normalizeUpper(e.target.value), barangay: '' })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Barangay</label>
                <input className="form-control" list="customer-barangay-options" value={form.barangay || ''} onChange={(e) => setForm({ ...form, barangay: normalizeUpper(e.target.value) })} />
              </div>
              <div className="col-md-6"><label className="form-label">Address Line 1</label><input className="form-control" value={form.addressLine1 || ''} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Address Line 2</label><input className="form-control" value={form.addressLine2 || ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
              <datalist id="customer-province-options">{provinceOptions.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="customer-city-options">{formCities.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="customer-barangay-options">{formBarangays.map((item) => <option key={item} value={item} />)}</datalist>
            </div>
          </section>
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Coordinates</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-3"><label className="form-label">Longitude</label><input className="form-control" value={form.longitude || ''} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Latitude</label><input className="form-control" value={form.latitude || ''} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
              <div className={hasCoordinateValues ? 'col-md-3 d-flex align-items-end' : 'col-md-6 d-flex align-items-end'}><button type="button" className="btn btn-outline-primary w-100" disabled={!canCaptureCoordinates} title={canCaptureCoordinates ? 'Capture coordinates from the selected customer location record' : 'Select a customer location record first'} onClick={openCoordinateCapture}><IconMapPin size={18} className="me-2" />Capture Coordinates</button></div>
              {hasCoordinateValues && (
                <div className="col-md-3 d-flex align-items-end"><button type="button" className="btn btn-outline-secondary w-100" onClick={clearCustomerCoordinates}><IconX size={18} className="me-2" />Clear</button></div>
              )}
            </div>
          </section>
        </div>
      );
    }
    return (
      <div className="customer-review-grid">
        <section>
          <h4>Profile</h4>
          {[
            ['Account Number', form.accountNumber || 'Auto on save'],
            ['Customer Type', form.customerType],
            ['Gender', form.gender],
            ...(normalizeUpper(form.customerType) === 'BUSINESS' ? [['Business Name', form.businessName]] : []),
            ['First Name', form.firstName],
            ['Middle Name', form.middleName],
            ['Last Name', form.lastName],
            ['Birth Date', formatDisplayDate(form.birthDate)],
            ['Recommended by customer', form.recommendedByCustomer ? 'Yes' : 'No'],
            ...(form.recommendedByCustomer ? [['Recommended by', formatRecommendedByCustomer(form)]] : [])
          ].map(([label, value]) => renderReviewItem(label, value))}
        </section>
        <section>
          <h4>Contact</h4>
          {[
            ['Contact Number', form.contactNumber],
            ['Alternate Mobile', form.alternateMobileNumber],
            ['Facebook Account', form.facebookAccountName],
            ['Facebook Profile Link', form.facebookProfileLink],
            ['Email', form.email]
          ].map(([label, value]) => renderReviewItem(label, value))}
        </section>
        <section>
          <h4>Location</h4>
          {[
            ['Customer Location Record', form.locationName || form.locationId],
            ['Landmark', form.landmark],
            ['Address Line 1', form.addressLine1],
            ['Address Line 2', form.addressLine2],
            ['Province', form.province],
            ['City', form.city],
            ['Barangay', form.barangay],
            ['Coordinates', [form.longitude, form.latitude].filter(Boolean).join(', ')]
          ].map(([label, value]) => renderReviewItem(label, value))}
        </section>
        <section>
          <h4>Secondary Contact</h4>
          {[
            ['Name', form.secondaryContactName],
            ['Number', form.secondaryContactNumber],
            ['Facebook', form.secondaryContactFacebookAccount],
            ['Relationship', form.secondaryContactRelationship]
          ].map(([label, value]) => renderReviewItem(label, value))}
        </section>
      </div>
    );
  }

  function renderCustomerDetailsPanel({ asModal = false } = {}) {
    if (!selected) return null;
    const DetailPanelTag = asModal ? 'div' : 'aside';
    const detailsCoordinates = customerCoordinates(selected);
    const detailsMap = detailsCoordinates
      ? coordinateTileData(
        detailsCoordinates.latitude,
        detailsCoordinates.longitude,
        detailsCoordinates.latitude,
        detailsCoordinates.longitude,
        COORDINATE_CAPTURE_ZOOM,
        activeCustomerMapProvider
      )
      : null;
    const basicInfoRows = [
      { label: 'Lives in', value: formatCustomerResidence(selected), icon: IconHome },
      { label: 'Birth Date', value: formatDisplayDate(selected.birthDate), icon: IconCalendarEvent },
      ...(selected.recommendedByCustomer
        ? [{ label: 'Recommended by', value: formatRecommendedByCustomer(selected), icon: IconUsers }]
        : []),
      ...(normalizeUpper(selected.customerType) === 'BUSINESS'
        ? [{ label: 'Business Name', value: selected.businessName, icon: IconActivity }]
        : [])
    ];
    const contactInfoRows = [
      { label: 'Primary contact', value: selected.contactNumber, icon: IconAddressBook },
      { label: 'Alternate mobile', value: selected.alternateMobileNumber, icon: IconAddressBook },
      { label: 'Facebook', value: selected.facebookAccountName, icon: IconUsers },
      { label: 'Email', value: selected.email, icon: IconAddressBook }
    ];
    const locationInfoRows = [
      { label: 'Customer location', value: selected.locationName || selected.locationId, icon: IconMapPin },
      { label: 'Landmark', value: selected.landmark, icon: IconMapPin },
      { label: 'Address', value: formatCustomerAddress(selected), icon: IconHome },
      { label: 'Coordinates', value: [selected.longitude, selected.latitude].filter(Boolean).join(', '), icon: IconMapPin }
    ];
    const renderInfoRow = ({ label, value, icon: InfoIcon }) => (
      <div className="customer-info-row" key={label}>
        <span className="customer-info-icon" aria-hidden="true"><InfoIcon size={17} /></span>
        <span className="customer-info-text">
          <span>{label}:</span>
          <strong>{String(value || '').trim() || '-'}</strong>
        </span>
      </div>
    );
    return (
      <DetailPanelTag className={`customer-detail-panel ${asModal ? 'customer-detail-modal-panel' : 'customer-inline-detail-panel'}`} aria-label="Selected customer details">
        <div className="customer-detail-panel-header">
          <div className="customer-detail-identity">
            <CustomerEmotionAvatar customer={selected} avatarConfig={avatarConfig} size={74} className="customer-detail-avatar" />
            <div className="customer-detail-heading">
              <h3 className="customer-modal-title">{selected.fullName}</h3>
              <div className="customer-detail-badges">
                <span className="badge bg-secondary-lt text-secondary">{selected.accountNumber}</span>
                <span className={`badge ${statusClass(selected.status)}`}>{selected.status}</span>
                <span className="badge bg-blue-lt text-blue">{selected.customerType}</span>
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeDetailsPanel}><IconX size={18} /></button>
        </div>
        <div className="customer-detail-panel-body">
          <div className="customer-detail">
            <div className="customer-status-tabs customer-detail-tabs" role="tablist" aria-label="Customer detail sections">
              {customerDetailTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.value}
                  className={`customer-status-tab customer-detail-tab ${customerDetailTab === tab.value ? 'active' : ''}`}
                  onClick={() => setCustomerDetailTab(tab.value)}
                  role="tab"
                  aria-selected={customerDetailTab === tab.value}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {customerDetailTab === 'basic' && (
              <section className="customer-info-panel">
                <h4>Basic Info</h4>
                <div className="customer-info-list">{basicInfoRows.map(renderInfoRow)}</div>
                <div className="customer-secondary-section">
                  <h4>Contact Info</h4>
                  <div className="customer-info-list">{contactInfoRows.map(renderInfoRow)}</div>
                </div>
                <div className="customer-secondary-section">
                  <h4>Secondary Contacts</h4>
                  {selected.secondaryContacts?.length ? selected.secondaryContacts.map((contact, index) => (
                    <div className="secondary-contact" key={`${contact.name}-${index}`}>
                      <div>{contact.name}</div>
                      <small>{contact.relationship || '-'} | {contact.contactNumber || '-'}</small>
                    </div>
                  )) : <div className="text-muted">No secondary contacts.</div>}
                </div>
              </section>
            )}
            {customerDetailTab === 'location' && (
              <section className="customer-info-panel">
                <h4>Location Info</h4>
                <div className="customer-info-list">{locationInfoRows.map(renderInfoRow)}</div>
                {detailsCoordinates && detailsMap && (
                  <div className="customer-detail-map-panel">
                    <a
                      className="customer-detail-map-preview"
                      href={googleMapsUrl(detailsCoordinates.latitude, detailsCoordinates.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open customer coordinates in Google Maps"
                    >
                      <span className="customer-detail-map-preview-heading">
                        <strong>Location Map</strong>
                        <small>Open in Google Maps</small>
                      </span>
                      <span className="customer-detail-map-tiles" aria-hidden="true">
                        {detailsMap.tiles.map((tile) => <img key={tile.key} src={tile.url} alt="" draggable="false" />)}
                        <span className="customer-detail-map-marker" style={detailsMap.marker}><IconMapPin size={20} /></span>
                      </span>
                    </a>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </DetailPanelTag>
    );
  }

  function renderSortIcon(column) {
    if (filters.sortBy !== column.sortBy) return <IconArrowsSort size={14} />;
    return filters.sortDir === 'asc' ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />;
  }

  function renderCustomerHeader(column) {
    return (
      <th key={column.key}>
        <button
          type="button"
          className={`customer-sort-button ${filters.sortBy === column.sortBy ? 'active' : ''}`}
          onClick={() => toggleSort(column.sortBy)}
          aria-label={`Sort by ${column.label}`}
        >
          <span>{column.label}</span>
          {renderSortIcon(column)}
        </button>
      </th>
    );
  }

  function formatSecondaryContacts(customer) {
    const contacts = customer.secondaryContacts || [];
    if (!contacts.length) return '-';
    return contacts
      .map((contact) => [
        contact.name,
        contact.relationship,
        contact.contactNumber
      ].map((part) => String(part || '').trim()).filter(Boolean).join(' - '))
      .filter(Boolean)
      .join('; ') || '-';
  }

  function formatCustomerCoordinates(customer) {
    return [customer.longitude, customer.latitude].filter(Boolean).join(', ') || '-';
  }

  function renderPlainCustomerCell(columnKey, value) {
    return (
      <td key={columnKey}>
        <span className="customer-table-value">{String(value || '').trim() || '-'}</span>
      </td>
    );
  }

  function renderCustomerCell(customer, columnKey) {
    if (columnKey === 'name') {
      return (
        <td key={columnKey}>
          <div className="d-flex align-items-center gap-2">
            <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} size={34} />
            <div className="customer-name-cell">
              <div className="fw-semibold">{customer.fullName}</div>
            </div>
          </div>
        </td>
      );
    }
    if (columnKey === 'account') {
      return <td key={columnKey}><span className="fw-semibold">{customer.accountNumber}</span></td>;
    }
    if (columnKey === 'contact') return renderPlainCustomerCell(columnKey, customer.contactNumber);
    if (columnKey === 'type') {
      return <td key={columnKey}><span className="badge bg-blue-lt text-blue">{customer.customerType}</span></td>;
    }
    if (columnKey === 'status') {
      return <td key={columnKey}><span className={`badge ${statusClass(customer.status)}`}>{customer.status}</span></td>;
    }
    if (columnKey === 'businessName') return renderPlainCustomerCell(columnKey, customer.businessName);
    if (columnKey === 'birthDate') return renderPlainCustomerCell(columnKey, formatDisplayDate(customer.birthDate));
    if (columnKey === 'recommendedByCustomerName') return renderPlainCustomerCell(columnKey, customer.recommendedByCustomer ? formatRecommendedByCustomer(customer) : '-');
    if (columnKey === 'alternateMobileNumber') return renderPlainCustomerCell(columnKey, customer.alternateMobileNumber);
    if (columnKey === 'facebookAccountName') return renderPlainCustomerCell(columnKey, customer.facebookAccountName);
    if (columnKey === 'facebookProfileLink') return renderPlainCustomerCell(columnKey, customer.facebookProfileLink);
    if (columnKey === 'email') return renderPlainCustomerCell(columnKey, customer.email);
    if (columnKey === 'secondaryContacts') return renderPlainCustomerCell(columnKey, formatSecondaryContacts(customer));
    if (columnKey === 'residence') return renderPlainCustomerCell(columnKey, formatCustomerResidence(customer));
    if (columnKey === 'locationName') return renderPlainCustomerCell(columnKey, customer.locationName || customer.locationId);
    if (columnKey === 'landmark') return renderPlainCustomerCell(columnKey, customer.landmark);
    if (columnKey === 'address') return renderPlainCustomerCell(columnKey, formatCustomerLocation(customer));
    if (columnKey === 'province') return renderPlainCustomerCell(columnKey, customer.province);
    if (columnKey === 'city') return renderPlainCustomerCell(columnKey, customer.city);
    if (columnKey === 'barangay') return renderPlainCustomerCell(columnKey, customer.barangay);
    if (columnKey === 'coordinates') return renderPlainCustomerCell(columnKey, formatCustomerCoordinates(customer));
    if (columnKey === 'longitude') return renderPlainCustomerCell(columnKey, customer.longitude);
    if (columnKey === 'latitude') return renderPlainCustomerCell(columnKey, customer.latitude);
    return null;
  }

  function renderCustomerActionButtons(customer, compact = false) {
    const actions = [
      { label: 'View', icon: IconEye, tone: 'blue', onClick: viewCustomer },
      { label: 'Edit', icon: IconEdit, tone: 'azure', onClick: editCustomer },
      { label: 'Check Serviceability', icon: IconHomeSignal, tone: 'green', onClick: checkCustomerServiceability },
      { label: 'Archive', icon: IconTrash, tone: 'red', onClick: deleteCustomer }
    ];
    return actions.map(({ label, icon: ActionIcon, tone, onClick }) => (
      <button
        type="button"
        key={label}
        className={`badge customer-action-badge bg-${tone}-lt text-${tone} border-0 ${compact ? 'compact' : ''}`}
        title={label}
        aria-label={`${label} ${customer.fullName}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpenCustomerActionMenuId('');
          onClick(customer);
        }}
      >
        <ActionIcon size={compact ? 18 : 21} />
        {compact && <span>{label}</span>}
      </button>
    ));
  }

  function renderCustomerActions(customer) {
    const menuOpen = openCustomerActionMenuId === customer.id;
    return (
      <td className="customer-actions-column">
        <div className="customer-row-actions" onClick={(event) => event.stopPropagation()}>
          <div className="customer-actions-inline">
            {renderCustomerActionButtons(customer)}
          </div>
          <div className="customer-actions-overflow">
            <button
              type="button"
              className="badge customer-action-badge bg-secondary-lt text-secondary border-0"
              title="More actions"
              aria-label={`More actions for ${customer.fullName}`}
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setOpenCustomerActionMenuId(menuOpen ? '' : customer.id);
              }}
            >
              <IconDotsVertical size={21} />
            </button>
            {menuOpen && (
              <div className="customer-row-action-menu">
                {renderCustomerActionButtons(customer, true)}
              </div>
            )}
          </div>
        </div>
      </td>
    );
  }

  const kpis = [
    ['Total Customers', overview?.totalCustomers, IconUsers, 'azure'],
    ['Active', overview?.activeCustomers, IconActivity, 'green'],
    ['Pending', overview?.pendingCustomers, IconClock, 'yellow'],
    ['Enrile Customers', overview?.enrileCustomers, IconMapPin, 'blue']
  ];
  const ActiveCustomerFormStageIcon = customerFormStageIcons[formStage] || IconClipboardCheck;

  return (
    <>
    <div className={`customer-profile-workspace ${isDetailsPanelOpen && selected && !isMobileDetailsView ? 'has-detail-panel' : ''}`}>
      <div className="customer-profile-main">
        <div className="row row-cards customer-profile-page">
          {message && (
            <div className="col-12">
              <div className="alert alert-success customer-success-alert mb-0" role="status" aria-live="polite">
                <span className="customer-success-alert-icon" aria-hidden="true"><IconDeviceFloppy size={18} /></span>
                <span>{message}</span>
              </div>
            </div>
          )}
          {error && <div className="col-12"><div className="alert alert-danger mb-0">{error}</div></div>}
          {kpis.map(([label, value, Icon, tone]) => (
            <div className="col-sm-6 col-xl-3" key={label}>
              <div className="card status-card">
                <div className="card-body">
                  <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                  <div className="h1 mb-0">{value ?? 0}</div>
                  <div className="text-muted">{label}</div>
                </div>
              </div>
            </div>
          ))}

          <div className="col-12">
            <Card
              className="customer-table-card"
              title={`Customers (${customers.total})`}
              icon={IconUsers}
              actions={(
                <div className="btn-list customer-header-actions">
                  <div className="customer-header-search">
                    <label className="visually-hidden" htmlFor="customer-table-search">Search customers</label>
                    <div className="input-icon customer-header-search-input">
                      <span className="input-icon-addon"><IconSearch size={16} /></span>
                      <input
                        id="customer-table-search"
                        className="form-control form-control-sm"
                        placeholder="Search name, account, contact, Facebook"
                        value={filters.search}
                        onChange={(event) => handleSearchChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            submitSearch();
                          }
                        }}
                      />
                      {filters.search && (
                        <button type="button" className="customer-search-clear" title="Clear search" aria-label="Clear search" onClick={clearSearch}>
                          <IconX size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <button className="btn btn-outline-primary btn-sm" onClick={openBulkUploadModal}>
                    <IconUpload size={16} className="me-1" />Bulk Upload
                  </button>
                  <button className="btn btn-primary btn-sm customer-header-icon-button" title="New Customer" aria-label="New Customer" onClick={openNewCustomerModal}>
                    <IconPlus size={16} />
                  </button>
                  <button className="btn btn-outline-secondary btn-sm customer-header-icon-button customer-draft-icon-button" title="Drafts" aria-label={`Drafts, ${customerDrafts.length} saved`} onClick={openDraftPanel}>
                    <IconClipboardList size={16} />
                    <span className="badge bg-blue-lt text-blue customer-header-icon-count">{customerDrafts.length}</span>
                  </button>
                  <button
                    className={`btn btn-outline-secondary btn-sm customer-header-icon-button ${areFiltersOpen ? 'active' : ''}`}
                    title={areFiltersOpen ? (hasActiveTableFilters ? 'Clear Filters' : 'Close Filter') : 'Filter'}
                    aria-label={areFiltersOpen ? (hasActiveTableFilters ? 'Clear Filters' : 'Close Filter') : 'Filter'}
                    onClick={handleFilterButtonClick}
                    aria-expanded={areFiltersOpen}
                  >
                    {areFiltersOpen ? <IconX size={16} /> : <IconFilter size={16} />}
                  </button>
                  <div className="customer-column-menu-wrapper">
                    <button
                      type="button"
                      ref={columnMenuButtonRef}
                      className={`btn btn-outline-secondary btn-sm customer-header-icon-button ${isColumnMenuOpen ? 'active' : ''}`}
                      title={`Column display for ${activeColumnPreferenceLabel}`}
                      aria-label={`Column display for ${activeColumnPreferenceLabel}`}
                      aria-expanded={isColumnMenuOpen}
                      onClick={toggleColumnMenu}
                    >
                      <IconColumns size={16} />
                    </button>
                    {isColumnMenuOpen && (
                      <div className="customer-column-menu" role="menu" style={columnMenuPosition}>
                        <div>
                          <div className="customer-column-menu-title">Display columns</div>
                          <div className="customer-column-menu-subtitle">Saved for {activeColumnPreferenceLabel} customers</div>
                        </div>
                        <div className="customer-column-search">
                          <label className="visually-hidden" htmlFor="customer-column-search">Search display columns</label>
                          <input
                            id="customer-column-search"
                            className="form-control form-control-sm"
                            placeholder="Search columns"
                            value={columnMenuSearch}
                            onChange={(event) => setColumnMenuSearch(event.target.value)}
                          />
                          {columnMenuSearch && (
                            <button type="button" className="btn btn-icon btn-sm" title="Clear column search" aria-label="Clear column search" onClick={() => setColumnMenuSearch('')}>
                              <IconX size={15} />
                            </button>
                          )}
                        </div>
                        {filteredCustomerTableColumnGroups.map(({ group, columns }) => (
                          <div className="customer-column-group" key={group}>
                            <div className="customer-column-group-title">{group}</div>
                            {columns.map((column) => {
                              const checked = visibleCustomerColumns[column.key] !== false;
                              return (
                                <label className="form-check customer-column-option" key={column.key}>
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={checked}
                                    disabled={checked && visibleCustomerColumnCount <= 1}
                                    onChange={() => toggleCustomerColumn(column.key)}
                                  />
                                  <span className="form-check-label">{column.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        ))}
                        {!filteredCustomerTableColumnGroups.length && (
                          <div className="customer-column-empty">No matching columns.</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            >
              {areFiltersOpen && (
                <div className="customer-table-filters">
                  <div className="row g-2 align-items-end">
                    <div className="col-md-3">
                      <label className="form-label">Type</label>
                      <select className="form-select" value={filters.customerType} onChange={(e) => updateFilters({ customerType: e.target.value })}>
                        <option value="">All</option>
                        {meta.customerTypes.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Province</label>
                      <select className="form-select" value={filters.province} onChange={(e) => updateFilters({ province: e.target.value, city: '', barangay: '' })}>
                        <option value="">All</option>
                        {provinceOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">City</label>
                      <select className="form-select" value={filters.city} onChange={(e) => updateFilters({ city: e.target.value, barangay: '' })}>
                        <option value="">All</option>
                        {cities.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Barangay</label>
                      <select className="form-select" value={filters.barangay} onChange={(e) => updateFilters({ barangay: e.target.value })}>
                        <option value="">All</option>
                        {barangays.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-auto">
                      <button className="btn" onClick={() => load(filters)}><IconRefresh size={18} className="me-2" />Refresh</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="customer-status-tabs" role="tablist" aria-label="Customer status filter">
                {statusTabs.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`customer-status-tab ${filters.status === item.value ? 'active' : ''}`}
                    onClick={() => updateFilters({ status: item.value })}
                    role="tab"
                    aria-selected={filters.status === item.value}
                  >
                    <span>{item.label}</span>
                    <span className={`badge bg-${item.tone}-lt text-${item.tone}`}>{item.count}</span>
                  </button>
                ))}
              </div>
              <div className="table-responsive">
                <table className="table card-table table-vcenter customer-table">
                  <thead>
                    <tr>
                      {activeCustomerColumns.map(renderCustomerHeader)}
                      <th className="customer-actions-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.data.map((customer) => (
                      <tr
                        key={customer.id}
                        className={`customer-clickable-row ${isDetailsPanelOpen && selected?.id === customer.id ? 'table-active' : ''}`}
                        onClick={(event) => handleCustomerRowClick(event, customer)}
                        onKeyDown={(event) => handleCustomerRowKeyDown(event, customer)}
                        tabIndex={0}
                        aria-label={`View ${customer.fullName}`}
                      >
                        {activeCustomerColumns.map((column) => renderCustomerCell(customer, column.key))}
                        {renderCustomerActions(customer)}
                      </tr>
                    ))}
                    {!customers.data.length && (
                      <tr><td colSpan={visibleCustomerColumnCount + 1}><div className="empty">No customers match the current filters.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
      {isDetailsPanelOpen && selected && !isMobileDetailsView && renderCustomerDetailsPanel()}
    </div>
    {isDetailsPanelOpen && selected && isMobileDetailsView && (
      <div className="customer-modal-backdrop customer-detail-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetailsPanel()}>
        <div className="customer-modal customer-detail-modal" role="dialog" aria-modal="true" aria-label="Customer details">
          {renderCustomerDetailsPanel({ asModal: true })}
        </div>
      </div>
    )}
    {isBulkUploadModalOpen && (
      <div className="customer-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeBulkUploadModal()}>
        <div className="customer-modal customer-bulk-upload-modal" role="dialog" aria-modal="true" aria-labelledby="customer-bulk-upload-title">
          <div className="customer-modal-header">
            <div>
              <div className="text-muted small">Import customer records</div>
              <h3 id="customer-bulk-upload-title" className="customer-modal-title">Bulk Upload</h3>
            </div>
            <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeBulkUploadModal}><IconX size={18} /></button>
          </div>
          <div className="customer-modal-body">
            <div className="btn-list mb-3">
              <button className="btn btn-outline-primary" onClick={downloadTemplate}><IconFileSpreadsheet size={18} className="me-2" />Download CSV Template</button>
              <label className="btn btn-primary mb-0">
                <IconUpload size={18} className="me-2" />Choose CSV File
                <input className="visually-hidden" type="file" accept=".csv,text/csv" onChange={handleBulkUploadFile} />
              </label>
            </div>
            {bulkUploadFileName && (
              <div className="bulk-upload-file">
                <IconFileSpreadsheet size={18} />
                <div>
                  <div className="fw-semibold">{bulkUploadFileName}</div>
                  <div className="text-muted small">{bulkUploadRows.length} parsed row{bulkUploadRows.length === 1 ? '' : 's'}</div>
                </div>
              </div>
            )}
            {!!bulkUploadFileErrors.length && (
              <div className="alert alert-danger">
                {bulkUploadFileErrors.map((item) => <div key={item}>{item}</div>)}
              </div>
            )}
            {!!bulkUploadRows.length && !bulkUploadFileErrors.length && (
              <>
                <div className="bulk-upload-summary">
                  <span className="badge bg-green-lt text-green">{validBulkUploadRows.length} valid</span>
                  <span className="badge bg-red-lt text-red">{invalidBulkUploadRows.length} needs fix</span>
                </div>
                <div className="bulk-upload-preview table-responsive">
                  <table className="table card-table table-vcenter">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>Contact</th>
                        <th>Location</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkUploadRows.slice(0, 8).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>
                            <div className="fw-semibold">{[row.data.firstName, row.data.middleName, row.data.lastName].filter(Boolean).join(' ') || '-'}</div>
                            {!!row.errors.length && <div className="text-danger small">{row.errors.join(', ')}</div>}
                          </td>
                          <td>{row.data.contactNumber || '-'}</td>
                          <td>{[row.data.landmark || row.data.locationName, row.data.barangay, row.data.city].filter(Boolean).join(', ') || '-'}</td>
                          <td><span className={`badge ${row.errors.length ? 'bg-red-lt text-red' : 'bg-green-lt text-green'}`}>{row.errors.length ? 'Invalid' : 'Ready'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bulkUploadRows.length > 8 && <div className="text-muted small mt-2">Showing first 8 rows. All valid rows will be imported.</div>}
                </div>
                <div className="text-end mt-3">
                  <button className="btn btn-primary" disabled={!validBulkUploadRows.length || !!invalidBulkUploadRows.length || isBulkUploading} onClick={importBulkUploadRows}>
                    <IconUpload size={18} className="me-2" />{isBulkUploading ? 'Importing...' : `Import ${validBulkUploadRows.length} Customer${validBulkUploadRows.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
            {bulkUploadResult && (
              <div className={`alert ${bulkUploadResult.failed ? 'alert-warning' : 'alert-success'} mt-3 mb-0`}>
                <div>{bulkUploadResult.created} imported, {bulkUploadResult.failed} failed.</div>
                {bulkUploadResult.failures.map((failure) => <div key={failure.rowNumber}>Row {failure.rowNumber}: {failure.message}</div>)}
              </div>
            )}
            <div className="small text-muted mb-2">Required headers</div>
            <div className="bulk-header-list">
              {requiredBulkUploadHeaders.map((item) => <span className="badge bg-blue-lt text-blue" key={item}>{item}</span>)}
            </div>
          </div>
        </div>
      </div>
    )}
    {isFormModalOpen && (
      <div className="customer-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeCustomerFormModal()}>
        <div className={`customer-modal customer-form-modal ${isEditingCustomer ? '' : 'customer-form-wizard-modal'}`} role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
          <div className="customer-modal-header">
            <div>
              {(editingId || activeDraftId) && (
                <div className="text-muted small">
                  {editingId ? 'Update existing profile' : 'Continue customer draft'}
                </div>
              )}
              <h3 id="customer-form-title" className="customer-modal-title">{editingId ? 'Edit Customer Profile' : 'Create Customer Profile'}</h3>
            </div>
            <div className="customer-modal-header-actions">
              {!isEditingCustomer && <span className="badge bg-blue-lt text-blue">Step {formStage + 1} of {customerFormStages.length}</span>}
              <button type="button" className="btn btn-icon" aria-label="Close" onClick={closeCustomerFormModal}><IconX size={18} /></button>
            </div>
          </div>
          <div className="customer-modal-body">
            <form className="customer-form-shell" onSubmit={saveCustomer}>
              <div className="customer-form-modal-scroll">
                <div className="customer-stage-layout">
                  {isEditingCustomer ? (
                    <ul className="nav nav-tabs customer-edit-tabs" role="tablist" aria-label="Customer edit sections">
                      {customerFormStages.map((stage, index) => {
                        const StageIcon = customerFormStageIcons[index];
                        return (
                          <li className="nav-item" role="presentation" key={stage.title}>
                            <button
                              type="button"
                              className={`nav-link ${formStage === index ? 'active' : ''}`}
                              onClick={() => setFormStage(index)}
                              role="tab"
                              aria-selected={formStage === index}
                              title={stage.description}
                            >
                              <StageIcon size={16} className="me-2" />
                              {stage.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <>
                      <div className="customer-form-progress" aria-label={`Customer form ${customerWizardProgress}% complete`}>
                        <div className="customer-form-progress-track">
                          <span style={{ width: `${customerWizardProgress}%` }} />
                          <strong style={{ left: `clamp(1.125rem, ${customerWizardProgress}%, calc(100% - 1.125rem))` }}>{customerWizardProgress}%</strong>
                        </div>
                      </div>
                      <div className="customer-stage-nav" role="tablist" aria-label="Customer form stages">
                        {customerFormStages.map((stage, index) => (
                          <button
                            type="button"
                            className={`customer-stage-button ${formStage === index ? 'active' : ''}`}
                            key={stage.title}
                            onClick={() => goToCustomerFormStage(index)}
                            disabled={!canOpenCustomerFormStage(index)}
                            role="tab"
                            aria-selected={formStage === index}
                            data-description={stage.description}
                            title={stage.description}
                          >
                            <span className={`customer-stage-indicator ${displayedCompletedFormStages[index] ? 'complete' : ''}`}>
                              {displayedCompletedFormStages[index] ? <IconCheck size={14} /> : index + 1}
                            </span>
                            <strong>{stage.title}</strong>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="customer-stage-panel">
                    <div className="customer-stage-heading">
                      <span className="customer-stage-title-badge" aria-hidden="true">
                        <ActiveCustomerFormStageIcon size={28} />
                      </span>
                      <div>
                        <h4>{customerFormStages[formStage].title}</h4>
                        <p>{customerFormStages[formStage].description}</p>
                      </div>
                    </div>
                    {renderCustomerFormStage()}
                  </div>
                </div>
              </div>
              <div className="customer-form-footer">
                <div className="btn-list">
                  <button type="button" className="btn" onClick={resetForm}>Clear</button>
                  {!editingId && (
                    <button type="button" className="btn btn-outline-primary" disabled={!hasFormDraftData} onClick={() => saveCurrentDraft()}>
                      <IconClipboardList size={18} className="me-2" />Save Draft
                    </button>
                  )}
                </div>
                <div className="btn-list">
                  <button type="button" className="btn" onClick={closeCustomerFormModal}>Cancel</button>
                  {isEditingCustomer ? (
                    <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Customer</button>
                  ) : (
                    <>
                      <button type="button" className="btn" disabled={formStage === 0} onClick={previousCustomerFormStage}>
                        <IconChevronLeft size={18} className="me-2" />Previous
                      </button>
                      {formStage < lastFormStage ? (
                        <button type="button" className="btn btn-primary" disabled={!canOpenCustomerFormStage(formStage + 1)} onClick={nextCustomerFormStage}>
                          Next<IconChevronRight size={18} className="ms-2" />
                        </button>
                      ) : (
                        <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Customer</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}

    {coordinateCapture && coordinateMap && (
      <div className="customer-modal-backdrop customer-coordinate-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCoordinateCapture(null)}>
        <div className="customer-modal customer-coordinate-modal" role="dialog" aria-modal="true" aria-labelledby="coordinate-capture-title">
          <div className="customer-modal-header">
            <div>
              <h3 id="coordinate-capture-title" className="customer-modal-title">Capture Longitude and Latitude</h3>
            </div>
            <button type="button" className="btn btn-icon btn-sm customer-modal-close" title="Close" onClick={() => setCoordinateCapture(null)}><IconX size={18} /></button>
          </div>
          <div className="customer-modal-body">
            <div className={`customer-coordinate-layout ${coordinateCapture.streetViewEnabled ? 'has-street-view' : ''}`}>
              <div className="customer-coordinate-map-column">
                <div className="customer-coordinate-map-shell">
                  <div
                    className={`customer-coordinate-map ${coordinatePan ? 'is-panning' : ''}`}
                    onPointerDown={startCoordinatePan}
                    onPointerMove={moveCoordinatePan}
                    onPointerUp={finishCoordinatePan}
                    onPointerCancel={finishCoordinatePan}
                    onWheel={handleCoordinateMapWheel}
                    role="application"
                    tabIndex={0}
                    aria-label="Pan map and select coordinates"
                  >
                    {coordinateMap.tiles.map((tile) => <img key={tile.key} src={tile.url} alt="" draggable="false" />)}
                    <span className="customer-coordinate-marker" style={coordinateMap.marker}><IconMapPin size={28} /></span>
                  </div>
                  <div className="customer-coordinate-controls" aria-label="Map controls">
                    <select
                      className="form-select form-select-sm customer-coordinate-provider-select"
                      value={customerMapProvider?.id || ''}
                      onChange={(event) => setCustomerMapProviderId(event.target.value)}
                      aria-label="Coordinate map provider"
                    >
                      {customerMapProviderOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-icon btn-sm" title="Zoom in" onClick={() => changeCoordinateZoom(1)} disabled={coordinateCapture.zoom >= coordinateCaptureMaxZoom}><IconPlus size={16} /></button>
                    <button type="button" className="btn btn-icon btn-sm" title="Zoom out" onClick={() => changeCoordinateZoom(-1)} disabled={coordinateCapture.zoom <= COORDINATE_CAPTURE_MIN_ZOOM}><IconMinus size={16} /></button>
                    <button type="button" className="btn btn-icon btn-sm" title="Center on barangay location" onClick={recenterCoordinateCapture}><IconCurrentLocation size={16} /></button>
                  </div>
                  {mapProviderNeedsSession(customerMapProvider) && !customerMapProviderSession && !customerMapProviderSessionError && (
                    <small className="customer-coordinate-provider-status">Starting Google map session...</small>
                  )}
                  {customerMapProviderSessionError && (
                    <small className="customer-coordinate-provider-status error">{customerMapProviderSessionError}</small>
                  )}
                </div>
                <div className="customer-coordinate-readout">
                  <div><span>Longitude</span><strong>{coordinateCapture.selectedLongitude.toFixed(6)}</strong></div>
                  <div><span>Latitude</span><strong>{coordinateCapture.selectedLatitude.toFixed(6)}</strong></div>
                  <div><span>Zoom</span><strong>{coordinateCapture.zoom}</strong></div>
                </div>
              </div>
              {coordinateCapture.streetViewEnabled && (
                <aside className="customer-street-view-panel" aria-label="Street view preview">
                  <div className="customer-street-view-heading">
                    <strong>Street View</strong>
                    <span>Based on selected coordinates</span>
                  </div>
                  <iframe
                    title="Street view preview"
                    src={buildStreetViewUrl(coordinateCapture.selectedLatitude, coordinateCapture.selectedLongitude)}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </aside>
              )}
            </div>
            <div className="customer-form-footer">
              <button type="button" className="btn" onClick={() => setCoordinateCapture(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={applyCoordinateCapture}><IconMapPin size={18} className="me-2" />Use Coordinates</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {isDraftPanelOpen && (
      <div className="customer-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDraftPanel()}>
        <aside className="customer-detail-panel customer-draft-panel" aria-label="Customer drafts">
          <div className="customer-detail-panel-header">
            <div>
              <div className="text-muted small">Temporary customer records</div>
              <h3 className="customer-modal-title">Customer Drafts</h3>
              <div className="text-muted">{customerDrafts.length} saved draft{customerDrafts.length === 1 ? '' : 's'}</div>
            </div>
            <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeDraftPanel}><IconX size={18} /></button>
          </div>
          <div className="customer-detail-panel-body">
            {!!selectedDraftIds.length && (
              <div className="customer-draft-toolbar">
                <span>{selectedDraftIds.length} selected</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeDrafts(selectedDraftIds)}>
                  <IconTrash size={16} className="me-1" />Delete Selected
                </button>
              </div>
            )}
            {!customerDrafts.length && <div className="empty">No customer drafts yet.</div>}
            <div className="customer-draft-list">
              {customerDrafts.map((draft) => (
                <div
                  className="customer-draft-card"
                  key={draft.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => continueDraft(draft)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      continueDraft(draft);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDraftIds.includes(draft.id)}
                    onChange={(event) => {
                      event.stopPropagation();
                      toggleDraftSelection(draft.id);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${draftTitle(draft)}`}
                  />
                  <span className="customer-draft-card-body">
                    <strong>{draftTitle(draft)}</strong>
                    <small>{[draft.form?.contactNumber, draft.form?.barangay, draft.form?.city].filter(Boolean).join(' / ') || 'No contact or address yet'}</small>
                    <small>Updated {formatDraftDate(draft.updatedAt)}</small>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="btn btn-icon btn-sm text-danger"
                    title="Delete draft"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeDrafts([draft.id]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        removeDrafts([draft.id]);
                      }
                    }}
                  >
                    <IconTrash size={16} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    )}

    </>
  );
}
