import React, { useEffect, useRef, useState } from 'react';
import {
  IconActivity,
  IconAddressBook,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardCheck,
  IconClipboardList,
  IconClock,
  IconCurrentLocation,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFileSpreadsheet,
  IconFilter,
  IconMapPin,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconX
} from '@tabler/icons-react';
import CustomerEmotionAvatar from '../../system-settings/web/CustomerEmotionAvatar';
import './customerProfiling.css';

const API = '/api';
const CUSTOMER_DRAFT_STORAGE_KEY = 'threejmain_customer_profile_drafts';
const DEFAULT_CAPTURE_COORDINATES = { latitude: 17.559311, longitude: 121.684928 };
const COORDINATE_CAPTURE_ZOOM = 15;
const COORDINATE_CAPTURE_MIN_ZOOM = 12;
const COORDINATE_CAPTURE_MAX_ZOOM = 19;
const MAP_TILE_SIZE = 256;
const MAP_TILE_COUNT = 3;

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

function coordinateTileData(centerLatitude, centerLongitude, selectedLatitude, selectedLongitude, zoom = COORDINATE_CAPTURE_ZOOM) {
  const centerX = lonToTileX(centerLongitude, zoom);
  const centerY = latToTileY(centerLatitude, zoom);
  const baseX = Math.floor(centerX) - 1;
  const baseY = Math.floor(centerY) - 1;
  const tiles = [];
  for (let row = 0; row < MAP_TILE_COUNT; row += 1) {
    for (let column = 0; column < MAP_TILE_COUNT; column += 1) {
      const x = baseX + column;
      const y = baseY + row;
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        url: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
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

function Card({ title, icon: Icon, children, actions }) {
  return (
    <div className="card">
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
  status: 'ACTIVE'
};

const blankCustomerFilters = {
  search: '',
  customerType: '',
  status: '',
  province: '',
  city: '',
  barangay: '',
  page: 1,
  pageSize: 10
};

const customerFormStages = [
  { title: 'Profile', description: 'Account identity and lifecycle' },
  { title: 'Contact', description: 'Primary and secondary contact information' },
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

export default function CustomerProfilingPage({ refreshShell = () => {} }) {
  const [overview, setOverview] = useState(null);
  const [meta, setMeta] = useState({ customerTypes: [], customerStatuses: [], customerGenders: [], provinces: [], cities: [], citiesByProvince: {}, barangays: [], barangaysByProvinceCity: {}, bulkUploadHeaders: [] });
  const [locations, setLocations] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
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
  const [areFiltersOpen, setFiltersOpen] = useState(false);
  const [formStage, setFormStage] = useState(0);
  const [contactStageTab, setContactStageTab] = useState('primary');
  const [customerDrafts, setCustomerDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [isDraftPanelOpen, setDraftPanelOpen] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [coordinateCapture, setCoordinateCapture] = useState(null);
  const [coordinatePan, setCoordinatePan] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const coordinateDragMovedRef = useRef(false);

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
  const coordinateMap = coordinateCapture
    ? coordinateTileData(
      coordinateCapture.centerLatitude,
      coordinateCapture.centerLongitude,
      coordinateCapture.selectedLatitude,
      coordinateCapture.selectedLongitude,
      coordinateCapture.zoom
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

  async function load(nextFilters = filters) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== '') params.set(key, value);
    });
    try {
      const [nextOverview, nextCustomers, nextMeta, nextLocations, nextAvatarConfig] = await Promise.all([
        request('/customer-profiling/customers/overview'),
        request(`/customer-profiling/customers?${params.toString()}`),
        request('/customer-profiling/meta'),
        request('/system-settings/locations').catch(() => []),
        request('/system-settings/avatars').catch(() => null)
      ]);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setMeta(nextMeta);
      setLocations(Array.isArray(nextLocations) ? nextLocations : []);
      setAvatarConfig(nextAvatarConfig);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCustomer(id) {
    setError('');
    try {
      const customer = await request(`/customer-profiling/customers/${id}`);
      setSelected(customer);
      setDetailsPanelOpen(true);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setCustomerDrafts(readCustomerDrafts()); }, []);
  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function updateFilters(next) {
    const merged = { ...filters, ...next, page: 1 };
    setFilters(merged);
    load(merged);
  }

  function handleFilterButtonClick() {
    if (areFiltersOpen && hasActiveTableFilters) {
      const resetFilters = { ...blankCustomerFilters, pageSize: filters.pageSize };
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

  function continueDraft(draft) {
    setEditingId('');
    setActiveDraftId(draft.id);
    setForm({ ...blankCustomerForm, ...(draft.form || {}) });
    setFormStage(Math.min(Math.max(Number(draft.stage) || 0, 0), lastFormStage));
    setContactStageTab('primary');
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
    setEditingId(customer.id);
    setActiveDraftId('');
    setFormStage(0);
    setContactStageTab('primary');
    setForm({
      ...blankCustomerForm,
      ...customer,
      landmark: customer.landmark || customer.locationName || '',
      secondaryContactName: customer.secondaryContactName || firstSecondary.name || '',
      secondaryContactNumber: customer.secondaryContactNumber || firstSecondary.contactNumber || '',
      secondaryContactFacebookAccount: customer.secondaryContactFacebookAccount || firstSecondary.facebookAccount || '',
      secondaryContactRelationship: customer.secondaryContactRelationship || firstSecondary.relationship || ''
    });
    setFormModalOpen(true);
    setMessage(`Editing ${customer.accountNumber}`);
  }

  function openNewCustomerModal() {
    setEditingId('');
    setActiveDraftId('');
    setFormStage(0);
    setContactStageTab('primary');
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
    setContactStageTab('primary');
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
  }

  function viewCustomer(customer) {
    if (!customer?.id) return;
    loadCustomer(customer.id);
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
    setContactStageTab('primary');
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
      const zoom = Math.min(COORDINATE_CAPTURE_MAX_ZOOM, Math.max(COORDINATE_CAPTURE_MIN_ZOOM, current.zoom + delta));
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
    const missingField = requiredFields.find(([key]) => !String(form[key] || '').trim());
    if (missingField) {
      setFormStage(missingField[2]);
      setError(`${missingField[1]} is required before saving the customer.`);
      return;
    }
    const method = editingId ? 'PATCH' : 'POST';
    const path = editingId ? `/customer-profiling/customers/${editingId}` : '/customer-profiling/customers';
    try {
      const saved = await request(path, { method, body: JSON.stringify(form) });
      setMessage(`${saved.accountNumber} saved.`);
      const shouldRefreshOpenDetails = isDetailsPanelOpen && selected?.id === saved.id;
      if (activeDraftId) removeDrafts([activeDraftId]);
      setEditingId('');
      setActiveDraftId('');
      setFormStage(0);
      setContactStageTab('primary');
      setForm({ ...blankCustomerForm });
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
              <div className="col-md-4"><label className="form-label">Customer Type</label><select className="form-select" value={form.customerType || 'RESIDENTIAL'} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>{meta.customerTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="col-md-4"><label className="form-label">Gender</label><select className="form-select" value={form.gender || 'MALE'} onChange={(e) => setForm({ ...form, gender: e.target.value })}>{(meta.customerGenders || ['MALE', 'FEMALE']).map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="col-md-4"><label className="form-label">Status</label><select className="form-select" value={form.status || 'ACTIVE'} onChange={(e) => setForm({ ...form, status: e.target.value })}>{meta.customerStatuses.map((item) => <option key={item}>{item}</option>)}</select></div>
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
            </div>
          </section>
        </div>
      );
    }
    if (formStage === 1) {
      return (
        <div className="customer-contact-stage">
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading customer-contact-section-heading">
              <h5>Contact Details</h5>
              <div className="customer-contact-tabs" role="tablist" aria-label="Contact sections">
                <button type="button" className={contactStageTab === 'primary' ? 'active' : ''} onClick={() => setContactStageTab('primary')} role="tab" aria-selected={contactStageTab === 'primary'}>Primary</button>
                <button type="button" className={contactStageTab === 'secondary' ? 'active' : ''} onClick={() => setContactStageTab('secondary')} role="tab" aria-selected={contactStageTab === 'secondary'}>Secondary</button>
              </div>
            </div>
            {contactStageTab === 'primary' ? (
              <div className="row g-3">
                <div className="col-md-6"><label className="form-label">Contact Number</label><input className="form-control" value={form.contactNumber || ''} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Alternate Mobile</label><input className="form-control" value={form.alternateMobileNumber || ''} onChange={(e) => setForm({ ...form, alternateMobileNumber: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Facebook Account</label><input className="form-control" value={form.facebookAccountName || ''} onChange={(e) => setForm({ ...form, facebookAccountName: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Facebook Profile Link</label><input className="form-control" value={form.facebookProfileLink || ''} onChange={(e) => setForm({ ...form, facebookProfileLink: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Email</label><input className="form-control" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
            ) : (
              <div className="row g-3">
                <div className="col-md-6"><label className="form-label">Secondary Contact</label><input className="form-control" value={form.secondaryContactName || ''} onChange={(e) => setForm({ ...form, secondaryContactName: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Secondary Number</label><input className="form-control" value={form.secondaryContactNumber || ''} onChange={(e) => setForm({ ...form, secondaryContactNumber: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Secondary Facebook</label><input className="form-control" value={form.secondaryContactFacebookAccount || ''} onChange={(e) => setForm({ ...form, secondaryContactFacebookAccount: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Relationship</label><input className="form-control" value={form.secondaryContactRelationship || ''} onChange={(e) => setForm({ ...form, secondaryContactRelationship: e.target.value })} /></div>
              </div>
            )}
          </section>
        </div>
      );
    }
    if (formStage === 2) {
      return (
        <div className="customer-stage-fields">
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Location Management</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Location Management Record</label>
                <select className="form-select" value={form.locationId || ''} onChange={(e) => applyLocation(e.target.value)}>
                  <option value="">Manual / create location on save</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                </select>
                <div className="form-hint">Missing customer locations are added to System Settings for completion later.</div>
              </div>
              <div className="col-md-6"><label className="form-label">Landmark</label><input className="form-control" value={form.landmark || ''} onChange={(e) => setForm({ ...form, landmark: e.target.value })} placeholder="Nearest landmark or service-area note" /></div>
            </div>
          </section>
          <section className="customer-form-section-panel">
            <div className="customer-form-section-heading">
              <h5>Service Address</h5>
            </div>
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Address Line 1</label><input className="form-control" value={form.addressLine1 || ''} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Address Line 2</label><input className="form-control" value={form.addressLine2 || ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
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
              <div className="col-md-4"><label className="form-label">Longitude</label><input className="form-control" value={form.longitude || ''} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label">Latitude</label><input className="form-control" value={form.latitude || ''} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
              <div className="col-md-4 d-flex align-items-end"><button type="button" className="btn btn-outline-primary w-100" disabled={!canCaptureCoordinates} title={canCaptureCoordinates ? 'Capture coordinates from the selected Location Management record' : 'Select a Location Management record first'} onClick={openCoordinateCapture}><IconMapPin size={18} className="me-2" />Capture Coordinates</button></div>
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
            ['Status', form.status],
            ...(normalizeUpper(form.customerType) === 'BUSINESS' ? [['Business Name', form.businessName]] : []),
            ['First Name', form.firstName],
            ['Middle Name', form.middleName],
            ['Last Name', form.lastName]
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
            ['Location Management Record', form.locationName || form.locationId],
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

  function renderCustomerDetailsPanel() {
    if (!selected) return null;
    const detailsCoordinates = customerCoordinates(selected);
    const detailsMap = detailsCoordinates
      ? coordinateTileData(
        detailsCoordinates.latitude,
        detailsCoordinates.longitude,
        detailsCoordinates.latitude,
        detailsCoordinates.longitude,
        COORDINATE_CAPTURE_ZOOM
      )
      : null;
    return (
      <aside className="customer-detail-panel customer-inline-detail-panel" aria-label="Selected customer details">
        <div className="customer-detail-panel-header">
          <div className="d-flex align-items-center gap-3">
            <CustomerEmotionAvatar customer={selected} avatarConfig={avatarConfig} size={48} showLabel />
            <div>
              <div className="text-muted small">Selected Customer</div>
              <h3 className="customer-modal-title">{selected.fullName}</h3>
              <div className="text-muted">{selected.accountNumber}</div>
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeDetailsPanel}><IconX size={18} /></button>
        </div>
        <div className="customer-detail-panel-body">
          <div className="customer-detail">
            <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
              <span className="badge bg-blue-lt text-blue">{selected.customerType}</span>
              <span className={`badge ${statusClass(selected.status)}`}>{selected.status}</span>
            </div>
            <dl className="detail-list">
              {normalizeUpper(selected.customerType) === 'BUSINESS' && (
                <>
                  <dt>Business name</dt><dd>{selected.businessName || '-'}</dd>
                </>
              )}
              <dt>Primary contact</dt><dd>{selected.contactNumber}</dd>
              <dt>Alternate mobile</dt><dd>{selected.alternateMobileNumber || '-'}</dd>
              <dt>Facebook</dt><dd>{selected.facebookAccountName || '-'}</dd>
              <dt>Email</dt><dd>{selected.email || '-'}</dd>
              <dt>Location record</dt><dd>{selected.locationName || selected.locationId || '-'}</dd>
              <dt>Landmark</dt><dd>{selected.landmark || '-'}</dd>
              <dt>Address</dt><dd>{formatCustomerAddress(selected)}</dd>
              <dt>Coordinates</dt><dd>{selected.longitude || '-'}, {selected.latitude || '-'}</dd>
            </dl>
            {detailsCoordinates && detailsMap && (
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
            )}
            <div className="border-top pt-3 mt-3">
              <div className="fw-semibold mb-2">Secondary contacts</div>
              {selected.secondaryContacts?.length ? selected.secondaryContacts.map((contact, index) => (
                <div className="secondary-contact" key={`${contact.name}-${index}`}>
                  <div>{contact.name}</div>
                  <small>{contact.relationship || '-'} | {contact.contactNumber || '-'}</small>
                </div>
              )) : <div className="text-muted">No secondary contacts.</div>}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const kpis = [
    ['Total Customers', overview?.totalCustomers, IconUsers, 'azure'],
    ['Active', overview?.activeCustomers, IconActivity, 'green'],
    ['Pending', overview?.pendingCustomers, IconClock, 'yellow'],
    ['Enrile Customers', overview?.enrileCustomers, IconMapPin, 'blue']
  ];

  return (
    <>
    <div className={`customer-profile-workspace ${isDetailsPanelOpen && selected ? 'has-detail-panel' : ''}`}>
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
              title={`Customers (${customers.total})`}
              icon={IconUsers}
              actions={(
                <div className="btn-list">
                  <button className="btn btn-outline-primary btn-sm" onClick={openBulkUploadModal}>
                    <IconUpload size={16} className="me-1" />Bulk Upload
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={openNewCustomerModal}>
                    <IconPlus size={16} className="me-1" />New Customer
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" onClick={openDraftPanel}>
                    <IconClipboardList size={16} className="me-1" />Drafts
                    <span className="badge bg-blue-lt text-blue ms-1">{customerDrafts.length}</span>
                  </button>
                  <button
                    className={`btn btn-outline-secondary btn-sm ${areFiltersOpen ? 'active' : ''}`}
                    onClick={handleFilterButtonClick}
                    aria-expanded={areFiltersOpen}
                  >
                    {areFiltersOpen ? <IconX size={16} className="me-1" /> : <IconFilter size={16} className="me-1" />}
                    {areFiltersOpen ? (hasActiveTableFilters ? 'Clear Filters' : 'Close Filter') : 'Filter'}
                  </button>
                </div>
              )}
            >
              {areFiltersOpen && (
                <div className="customer-table-filters">
                  <div className="row g-2 align-items-end">
                    <div className="col-md-4">
                      <label className="form-label">Search</label>
                      <div className="input-icon">
                        <span className="input-icon-addon"><IconSearch size={16} /></span>
                        <input className="form-control" placeholder="Name, account, contact, Facebook" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && updateFilters({ search: e.currentTarget.value })} />
                      </div>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Type</label>
                      <select className="form-select" value={filters.customerType} onChange={(e) => updateFilters({ customerType: e.target.value })}>
                        <option value="">All</option>
                        {meta.customerTypes.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Province</label>
                      <select className="form-select" value={filters.province} onChange={(e) => updateFilters({ province: e.target.value, city: '', barangay: '' })}>
                        <option value="">All</option>
                        {provinceOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="col-md-2">
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
                      <button className="btn btn-primary" onClick={() => updateFilters({ search: filters.search })}><IconSearch size={18} className="me-2" />Apply</button>
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
                      <th>Account</th>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Address</th>
                      <th className="w-1">Actions</th>
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
                        <td><span className="fw-semibold">{customer.accountNumber}</span></td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} size={34} />
                            <div>
                              <div className="fw-semibold">{customer.fullName}</div>
                              <div className="text-muted small">{customer.facebookAccountName || '-'}</div>
                            </div>
                          </div>
                        </td>
                        <td>{customer.contactNumber}</td>
                        <td><span className="badge bg-blue-lt text-blue">{customer.customerType}</span></td>
                        <td><span className={`badge ${statusClass(customer.status)}`}>{customer.status}</span></td>
                        <td>{formatCustomerLocation(customer)}</td>
                        <td>
                          <div className="btn-list flex-nowrap">
                            <button className="btn btn-icon btn-sm" title="View" onClick={(event) => { event.stopPropagation(); viewCustomer(customer); }}><IconEye size={16} /></button>
                            <button className="btn btn-icon btn-sm" title="Edit" onClick={(event) => { event.stopPropagation(); editCustomer(customer); }}><IconEdit size={16} /></button>
                            <button className="btn btn-icon btn-sm text-danger" title="Archive" onClick={(event) => { event.stopPropagation(); deleteCustomer(customer); }}><IconTrash size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!customers.data.length && (
                      <tr><td colSpan="7"><div className="empty">No customers match the current filters.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
      {isDetailsPanelOpen && selected && renderCustomerDetailsPanel()}
    </div>
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
                      <h4>{customerFormStages[formStage].title}</h4>
                      <p>{customerFormStages[formStage].description}</p>
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
                    <button type="button" className="btn btn-icon btn-sm" title="Zoom in" onClick={() => changeCoordinateZoom(1)} disabled={coordinateCapture.zoom >= COORDINATE_CAPTURE_MAX_ZOOM}><IconPlus size={16} /></button>
                    <button type="button" className="btn btn-icon btn-sm" title="Zoom out" onClick={() => changeCoordinateZoom(-1)} disabled={coordinateCapture.zoom <= COORDINATE_CAPTURE_MIN_ZOOM}><IconMinus size={16} /></button>
                    <button type="button" className="btn btn-icon btn-sm" title="Center on barangay location" onClick={recenterCoordinateCapture}><IconCurrentLocation size={16} /></button>
                  </div>
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
