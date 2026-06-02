import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertTriangle,
  IconAntenna,
  IconApi,
  IconBox,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDeviceFloppy,
  IconEdit,
  IconMap,
  IconMapPin,
  IconNetwork,
  IconPlayerPlay,
  IconPlus,
  IconRadar,
  IconRefresh,
  IconRouter,
  IconSearch,
  IconServer2,
  IconTrash,
  IconWifi,
  IconX,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react';
import './networkSettings.css';

const API = '/api';

const defaultMeta = {
  oltStatuses: ['PLANNED', 'ACTIVE', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  ponTechnologies: ['GPON', 'EPON', 'XGS_PON', 'OTHER'],
  adminStatuses: ['ENABLED', 'DISABLED', 'RESERVED'],
  operationalStatuses: ['UNKNOWN', 'UP', 'DEGRADED', 'DOWN'],
  napStatuses: ['PLANNED', 'ACTIVE', 'FULL', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  napSplitterRatios: ['1:8', '1:16'],
  fbtStatuses: ['PLANNED', 'ACTIVE', 'FULL', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  onuStatuses: ['UNKNOWN', 'ONLINE', 'OFFLINE', 'LOS', 'DYING_GASP', 'DISABLED'],
  deviceTypes: ['MIKROTIK', 'OLT'],
  deviceAccessMethods: ['API', 'SNMP'],
  deviceStatuses: ['PLANNED', 'ACTIVE', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  pppoeAccountStatuses: ['ONLINE', 'OFFLINE', 'DISABLED'],
  apiProtocols: ['MIKROTIK_API', 'REST', 'NETCONF', 'SSH', 'OTHER'],
  snmpVersions: ['V1', 'V2C', 'V3'],
  snmpTransports: ['UDP', 'TCP', 'UDP6', 'TCP6'],
  portAssociationModes: ['IFINDEX', 'IFNAME', 'IFDESCR', 'IFALIAS'],
  snmpAuthLevels: ['NO_AUTH_NO_PRIV', 'AUTH_NO_PRIV', 'AUTH_PRIV'],
  snmpAuthProtocols: ['MD5', 'SHA', 'SHA-224', 'SHA-256', 'SHA-384', 'SHA-512'],
  snmpPrivacyProtocols: ['AES', 'DES'],
  defaultPollIntervalSeconds: 300,
  onuTableRefreshSeconds: 15
};

const optionLabels = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  DYING_GASP: 'Dying Gasp',
  MIKROTIK: 'MikroTik',
  OLT: 'OLT',
  V1: 'v1',
  V2C: 'v2c',
  V3: 'v3',
  UDP: 'udp',
  TCP: 'tcp',
  UDP6: 'udp6',
  TCP6: 'tcp6',
  IFINDEX: 'ifIndex',
  IFNAME: 'ifName',
  IFDESCR: 'ifDescr',
  IFALIAS: 'ifAlias',
  NO_AUTH_NO_PRIV: 'noAuthNoPriv',
  AUTH_NO_PRIV: 'authNoPriv',
  AUTH_PRIV: 'authPriv'
};

function formatSplitterRatio(value) {
  return String(value || '').replace(':', 'x');
}

function normalizeNapSplitterRatio(value) {
  const normalized = String(value || '').trim().toLowerCase().replace('x', ':');
  return defaultMeta.napSplitterRatios.includes(normalized) ? normalized : '1:8';
}

const choiceIcons = {
  API: IconApi,
  SNMP: IconAntenna,
  MIKROTIK: IconRouter,
  OLT: IconServer2
};

const ONU_AUTO_REFRESH_SECONDS = 15;
const PPPOE_AUTO_REFRESH_SECONDS = 30;
const DEFAULT_MAP_SURFACE = { width: 1600, height: 900 };
const MAP_MIN_SCALE = 0.55;
const MAP_MAX_SCALE = 64;
const MAP_WHEEL_ZOOM_FACTOR = 1.28;
const MAP_BUTTON_ZOOM_FACTOR = 1.45;
const MAP_MAX_NATIVE_TILE_ZOOM = 19;
const DEFAULT_OLT_LOCATION_PICKER = { lat: 14.5995, lng: 120.9842, zoom: 17 };
const DEFAULT_OLT_LOCATION_PICKER_SURFACE = { width: 720, height: 320 };

const ponTechnologyDefaults = {
  GPON: { splitRatio: '1:128', capacity: '128' },
  XGS_PON: { splitRatio: '1:128', capacity: '128' },
  EPON: { splitRatio: '1:64', capacity: '64' },
  OTHER: { splitRatio: '1:64', capacity: '64' }
};

function ponDefaultsForTechnology(technology) {
  return ponTechnologyDefaults[technology] || ponTechnologyDefaults.OTHER;
}

const blankOlt = {
  id: '',
  name: '',
  site: 'Main POP',
  managementIp: '',
  vendor: 'Generic',
  model: '',
  firmwareVersion: '',
  status: 'ACTIVE',
  defaultPonCount: '4',
  notes: ''
};

const blankPon = {
  id: '',
  portNumber: '',
  label: '',
  technology: 'GPON',
  adminStatus: 'ENABLED',
  operationalStatus: 'UNKNOWN',
  splitRatio: '1:128',
  serviceVlan: '',
  capacity: '128',
  moduleVendor: '',
  modulePartNumber: '',
  moduleSerial: '',
  moduleHardwareRev: '',
  moduleRxPowerDbm: '',
  moduleTxPowerDbm: '',
  moduleTemperatureC: '',
  moduleVoltageV: '',
  moduleBiasCurrentMa: '',
  moduleSource: '',
  notes: ''
};

const blankNap = {
  id: '',
  name: '',
  ponPortId: '',
  location: '',
  barangay: '',
  latitude: '',
  longitude: '',
  splitterRatio: '1:8',
  portCapacity: '8',
  status: 'ACTIVE',
  notes: ''
};

const blankFbt = {
  id: '',
  name: '',
  napBoxId: '',
  portNumber: '',
  portCapacity: '8',
  status: 'ACTIVE',
  locationHint: '',
  notes: ''
};

const blankDevice = {
  id: '',
  name: '',
  deviceType: '',
  accessMethod: '',
  managementIp: '',
  site: 'Main POP',
  vendor: '',
  model: '',
  status: 'ACTIVE',
  apiProtocol: 'MIKROTIK_API',
  apiPort: '8728',
  apiUsername: '',
  apiPassword: '',
  apiProfile: '',
  snmpVersion: 'V2C',
  snmpPort: '161',
  snmpCommunity: '',
  snmpTransport: 'UDP',
  portAssociationMode: 'IFINDEX',
  pollerGroup: '0',
  forceAdd: false,
  snmpAuthLevel: 'NO_AUTH_NO_PRIV',
  snmpAuthName: '',
  snmpAuthPassword: '',
  snmpAuthProtocol: 'SHA',
  snmpPrivacyProtocol: 'AES',
  snmpPrivacyPassword: '',
  notes: ''
};

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

function titleize(value) {
  return optionLabels[value] || String(value || '').replaceAll('_', ' ');
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'enabled', 'up', 'online', 'success'].includes(normalized)) return 'green';
  if (['planned', 'reserved', 'unknown', 'maintenance', 'degraded'].includes(normalized)) return 'yellow';
  if (['offline', 'disabled', 'down', 'full', 'archived', 'los', 'dying_gasp', 'failed'].includes(normalized)) return 'red';
  return 'blue';
}

function badgeClass(status) {
  const tone = statusTone(status);
  return `bg-${tone}-lt text-${tone}`;
}

function numberOrBlank(value) {
  return value === '' || value === null || value === undefined ? '' : Number(value);
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatSysUpTime(value) {
  const ticks = Number(value || 0);
  if (!ticks) return '-';
  const totalSeconds = Math.floor(ticks / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatSeconds(value) {
  const seconds = Number(value || 0);
  if (!seconds) return 'Manual';
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function locationLabel(location) {
  return location.location_name
    || [location.barangay, location.municipality, location.province].filter(Boolean).join(', ')
    || location.address
    || location.id
    || 'Location';
}

function matches(row, search) {
  const term = String(search || '').trim().toLowerCase();
  if (!term) return true;
  return Object.values(row).join(' ').toLowerCase().includes(term);
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;

  const direction = (text.match(/[NSEW]/i)?.[0] || '').toUpperCase();
  const parts = text
    .replace(/[NSEW]/ig, '')
    .replace(/[^\d.+-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);
  if (!parts.length) return null;
  const sign = direction === 'S' || direction === 'W' || String(parts[0]).startsWith('-') ? -1 : 1;
  const degrees = Math.abs(parts[0]);
  const minutes = Math.abs(parts[1] || 0);
  const seconds = Math.abs(parts[2] || 0);
  if (minutes >= 60 || seconds >= 60) return null;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function hasCoordinates(row) {
  return parseCoordinate(row?.latitude) !== null && parseCoordinate(row?.longitude) !== null;
}

function oltPickerViewFromCoordinates(latitude, longitude, fallback = DEFAULT_OLT_LOCATION_PICKER) {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);
  if (lat === null || lng === null) return fallback;
  return { ...fallback, lat, lng };
}

function isSnmpOltDevice(device) {
  return device?.accessMethod === 'SNMP' && device?.deviceType === 'OLT';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function geoToWorldPixel(latitude, longitude, zoomLevel) {
  const lat = clamp(Number(latitude), -85.05112878, 85.05112878);
  const lng = Number(longitude);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = 256 * (2 ** zoomLevel);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function worldPixelToGeo(x, y, zoomLevel) {
  const scale = 256 * (2 ** zoomLevel);
  const boundedY = clamp(Number(y), 0, scale);
  const longitude = (Number(x) / scale) * 360 - 180;
  const normalizedLongitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  const n = Math.PI - (2 * Math.PI * boundedY) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude: normalizedLongitude };
}

function mapTileUrl(x, y, z) {
  const tileCount = 2 ** z;
  const normalizedX = ((x % tileCount) + tileCount) % tileCount;
  return `https://tile.openstreetmap.org/${z}/${normalizedX}/${y}.png`;
}

function uniqueNapKey(nap) {
  const name = String(nap?.name || '').trim().toLowerCase();
  if (!name) return String(nap?.id || '').trim().toLowerCase();
  const ponKey = String(nap?.ponPortId || nap?.ponId || nap?.ponLabel || '').trim().toLowerCase();
  return `${ponKey}::${name}`;
}

function uniqueNapRows(rows) {
  const seen = new Set();
  return rows.filter((nap) => {
    const key = uniqueNapKey(nap);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Card({ title, icon: Icon, children, actions, className = '' }) {
  return (
    <div className={`card ${className}`}>
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

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="network-header-search">
      <label className="visually-hidden">Search</label>
      <div className="input-icon network-header-search-input">
        <span className="input-icon-addon"><IconSearch size={16} /></span>
        <input className="form-control form-control-sm" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        {value && (
          <button type="button" className="network-search-clear" title="Clear search" aria-label="Clear search" onClick={() => onChange('')}>
            <IconX size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle }) {
  return (
    <div className="network-page-heading">
      <div>
        <div className="network-page-kicker">Network Settings</div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ value }) {
  return <span className={`badge ${badgeClass(value)}`}>{titleize(value)}</span>;
}

function formatDbm(value) {
  const text = String(value ?? '').trim();
  return text ? `${text} dBm` : '-';
}

function PonModuleCell({ pon }) {
  const vendor = String(pon.moduleVendor || '').trim();
  const partNumber = String(pon.modulePartNumber || '').trim();
  const serial = String(pon.moduleSerial || '').trim();
  const source = String(pon.moduleSource || '').trim();
  const telemetry = [
    pon.moduleTemperatureC ? `${pon.moduleTemperatureC} C` : '',
    pon.moduleVoltageV ? `${pon.moduleVoltageV} V` : '',
    pon.moduleBiasCurrentMa ? `${pon.moduleBiasCurrentMa} mA` : ''
  ].filter(Boolean).join(' / ');
  const hasModuleData = vendor
    || partNumber
    || serial
    || pon.moduleRxPowerDbm
    || pon.moduleTxPowerDbm
    || pon.moduleTemperatureC
    || pon.moduleVoltageV
    || pon.moduleBiasCurrentMa;
  if (!hasModuleData) {
    return (
      <td className="network-pon-module-cell">
        <span className="text-muted">No power data</span>
        <small>Add PON power</small>
      </td>
    );
  }
  return (
    <td className="network-pon-module-cell">
      <strong>{[vendor, partNumber].filter(Boolean).join(' / ') || 'Optical module'}</strong>
      <span>Rx {formatDbm(pon.moduleRxPowerDbm)} / Tx {formatDbm(pon.moduleTxPowerDbm)}</span>
      <small>{[serial && `SN ${serial}`, telemetry, source || 'Manual'].filter(Boolean).join(' / ')}</small>
    </td>
  );
}

function RowActions({ onEdit, onDelete, label, extraActions = [] }) {
  return (
    <td className="network-actions-column">
      <div className="network-row-actions">
        {extraActions.map((action) => {
          const ActionIcon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              className={`badge network-action-badge border-0 ${action.className}`}
              title={action.title}
              aria-label={action.title}
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
            >
              <ActionIcon size={18} />
            </button>
          );
        })}
        <button
          type="button"
          className="badge network-action-badge bg-azure-lt text-azure border-0"
          title={`Edit ${label}`}
          aria-label={`Edit ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <IconEdit size={18} />
        </button>
        <button
          type="button"
          className="badge network-action-badge bg-red-lt text-red border-0"
          title={`Delete ${label}`}
          aria-label={`Delete ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <IconTrash size={18} />
        </button>
      </div>
    </td>
  );
}

function TextInput({ label, value, onChange, type = 'text', required = false, min, max, placeholder = '', list = '' }) {
  return (
    <div className="col-md-4">
      <label className="form-label">{label}</label>
      <input
        className="form-control"
        type={type}
        min={min}
        max={max}
        required={required}
        placeholder={placeholder}
        list={list || undefined}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectInput({ label, value, onChange, options, required = false, children }) {
  return (
    <div className="col-md-4">
      <label className="form-label">{label}</label>
      <select className="form-select" required={required} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{titleize(option)}</option>)}
      </select>
    </div>
  );
}

function RadioChoiceInput({ label, value, options, onChange, formatLabel = (option) => option }) {
  return (
    <div className="col-md-4">
      <label className="form-label">{label}</label>
      <div className="network-choice-grid network-choice-grid-compact">
        {options.map((option) => (
          <label key={option} className={`network-radio-card ${value === option ? 'active' : ''}`}>
            <input
              className="form-check-input"
              type="radio"
              name={label.replaceAll(' ', '-').toLowerCase()}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{formatLabel(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AccessChoice({ value, options, onChange }) {
  return (
    <div className="col-12 col-md-6">
      <label className="form-label">Access</label>
      <div className="network-choice-grid network-choice-grid-compact">
        {options.map((option) => {
          const ChoiceIcon = choiceIcons[option] || IconNetwork;
          return (
            <label
              key={option}
              className={`network-radio-card ${value === option ? 'active' : ''}`}
            >
              <input
                className="form-check-input"
                type="radio"
                name="network-device-access"
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              <span className="network-choice-icon" aria-hidden="true"><ChoiceIcon size={16} /></span>
              <span>{titleize(option)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function DeviceTypeChoice({ value, options, onChange }) {
  return (
    <div className="col-12 col-md-6">
      <label className="form-label">Device Type</label>
      <div className="network-choice-grid">
        {options.map((option) => {
          const ChoiceIcon = choiceIcons[option] || IconNetwork;
          return (
            <label key={option} className={`network-radio-card ${value === option ? 'active' : ''}`}>
              <input
                className="form-check-input"
                type="radio"
                name="network-device-type"
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              <span className="network-choice-icon" aria-hidden="true"><ChoiceIcon size={16} /></span>
              <span>{titleize(option)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function CheckboxInput({ label, checked, onChange, help }) {
  return (
    <div className="col-md-4">
      <label className="form-label">{label}</label>
      <label className="form-check network-check-field">
        <input className="form-check-input" type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
        <span className="form-check-label">{help}</span>
      </label>
    </div>
  );
}

function NotesInput({ label, value, onChange }) {
  return (
    <div className="col-12">
      <label className="form-label">{label}</label>
      <textarea className="form-control" rows="3" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function CrudModal({ title, icon: Icon, children, onClose, onSubmit, submitDisabled = false, submitLabel = 'Save' }) {
  return (
    <div className="network-modal-backdrop" role="presentation">
      <div className="network-modal" role="dialog" aria-modal="true" aria-labelledby="network-modal-title">
        <div className="network-modal-header">
          <h3 id="network-modal-title" className="network-modal-title">
            {Icon && <Icon size={18} className="me-2 text-muted" />}
            {title}
          </h3>
          <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={onClose}><IconX size={18} /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="network-modal-body">
            <div className="row g-3">{children}</div>
          </div>
          <div className="network-modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitDisabled}><IconDeviceFloppy size={18} className="me-2" />{submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function canonicalPonLabel(pon) {
  const portNumber = Number(pon?.portNumber || 0);
  return pon?.ponLabel || pon?.displayLabel || (portNumber > 0 ? `PON${String(portNumber).padStart(2, '0')}` : 'PON');
}

function ponPathLabel(pon, olts = []) {
  const olt = olts.find((row) => row.id === pon.oltId) || {};
  return [
    pon.oltVendor || olt.vendor,
    pon.oltName || olt.name,
    canonicalPonLabel(pon)
  ].filter(Boolean).join('/');
}

function PonOptions({ pons, olts = [] }) {
  return (
    <>
      <option value="">Select PON</option>
      {pons.map((pon) => <option key={pon.id} value={pon.id}>{ponPathLabel(pon, olts)}</option>)}
    </>
  );
}

function NapOptions({ naps }) {
  return (
    <>
      <option value="">Select NAP</option>
      {naps.map((nap) => <option key={nap.id} value={nap.id}>{nap.name} / {nap.oltName} {nap.ponLabel}</option>)}
    </>
  );
}

function NapPonChoices({ pons, value, onChange }) {
  return (
    <div className="col-12">
      <label className="form-label">PON</label>
      {pons.length ? (
        <div className="network-choice-grid network-nap-pon-grid">
          {pons.map((pon) => (
            <label key={pon.id} className={`network-radio-card network-nap-pon-option ${value === pon.id ? 'active' : ''}`}>
              <input
                className="form-check-input"
                type="radio"
                name="network-nap-pon"
                value={pon.id}
                checked={value === pon.id}
                required
                onChange={() => onChange(pon.id)}
              />
              <span className="network-nap-pon-main">{canonicalPonLabel(pon)}</span>
              <small>{[titleize(pon.technology), pon.operationalStatus && titleize(pon.operationalStatus)].filter(Boolean).join(' / ')}</small>
            </label>
          ))}
        </div>
      ) : (
        <div className="empty network-nap-pon-empty">Choose an OLT with available PON ports.</div>
      )}
    </div>
  );
}

export default function NetworkSettingsPage({ initialSection = 'overview', refreshShell = () => {} }) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [meta, setMeta] = useState(defaultMeta);
  const [overview, setOverview] = useState({ metrics: {}, olts: [], recentNaps: [], recentFbts: [] });
  const [olts, setOlts] = useState([]);
  const [pons, setPons] = useState([]);
  const [naps, setNaps] = useState([]);
  const [fbts, setFbts] = useState([]);
  const [onus, setOnus] = useState([]);
  const [devices, setDevices] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mapImages, setMapImages] = useState(null);
  const [pppoeAccounts, setPppoeAccounts] = useState([]);
  const [pppoeKpis, setPppoeKpis] = useState({});
  const [pppoeRouters, setPppoeRouters] = useState([]);
  const [pppoeProfiles, setPppoeProfiles] = useState([]);
  const [pppoeDeviceErrors, setPppoeDeviceErrors] = useState([]);
  const [pppoeCapturedAt, setPppoeCapturedAt] = useState('');
  const [pppoeLoading, setPppoeLoading] = useState(false);
  const [pppoeStatusFilter, setPppoeStatusFilter] = useState('');
  const [pppoeRouterFilter, setPppoeRouterFilter] = useState('');
  const [pppoeProfileFilter, setPppoeProfileFilter] = useState('');
  const [pppoePageSize, setPppoePageSize] = useState(25);
  const [pppoePage, setPppoePage] = useState(1);
  const [pppoeSort, setPppoeSort] = useState({ key: 'username', direction: 'asc' });
  const [selectedOltId, setSelectedOltId] = useState('');
  const [expandedOltIds, setExpandedOltIds] = useState({});
  const [deviceTab, setDeviceTab] = useState('API');
  const [search, setSearch] = useState('');
  const [onuStatusFilter, setOnuStatusFilter] = useState('');
  const [onuOltFilter, setOnuOltFilter] = useState('');
  const [onuPonFilter, setOnuPonFilter] = useState('');
  const [napOltFilter, setNapOltFilter] = useState('');
  const [napPonFilter, setNapPonFilter] = useState('');
  const [napStatusFilter, setNapStatusFilter] = useState('');
  const [expandedNapOltIds, setExpandedNapOltIds] = useState({});
  const [expandedNapPonIds, setExpandedNapPonIds] = useState({});
  const [mapOltFilter, setMapOltFilter] = useState('');
  const [mapTypeFilter, setMapTypeFilter] = useState('');
  const [mapView, setMapView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [mapHighDetail, setMapHighDetail] = useState(true);
  const [mapLayerVisibility, setMapLayerVisibility] = useState({
    olts: true,
    naps: true,
    links: true,
    details: true
  });
  const [mapSurfaceSize, setMapSurfaceSize] = useState(DEFAULT_MAP_SURFACE);
  const [mapDragging, setMapDragging] = useState(false);
  const mapDragRef = useRef(null);
  const mapSurfaceRef = useRef(null);
  const [modalType, setModalType] = useState('');
  const [oltForm, setOltForm] = useState(blankOlt);
  const [ponForm, setPonForm] = useState(blankPon);
  const [napForm, setNapForm] = useState(blankNap);
  const [napSelectedOltId, setNapSelectedOltId] = useState('');
  const [napAddAnother, setNapAddAnother] = useState(false);
  const [napFormMessage, setNapFormMessage] = useState('');
  const [napFormError, setNapFormError] = useState('');
  const [napSaving, setNapSaving] = useState(false);
  const [fbtForm, setFbtForm] = useState(blankFbt);
  const [deviceForm, setDeviceForm] = useState(blankDevice);
  const [deviceFormError, setDeviceFormError] = useState('');
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [locationBindingDevice, setLocationBindingDevice] = useState(null);
  const [locationBindingSelection, setLocationBindingSelection] = useState([]);
  const [oltLocationForm, setOltLocationForm] = useState({ locationId: '', label: '', latitude: '', longitude: '' });
  const [oltLocationPickerOpen, setOltLocationPickerOpen] = useState(false);
  const [oltLocationPickerView, setOltLocationPickerView] = useState(DEFAULT_OLT_LOCATION_PICKER);
  const [oltLocationPickerSurfaceSize, setOltLocationPickerSurfaceSize] = useState(DEFAULT_OLT_LOCATION_PICKER_SURFACE);
  const [oltLocationPickerDragging, setOltLocationPickerDragging] = useState(false);
  const oltLocationPickerSurfaceRef = useRef(null);
  const oltLocationPickerDragRef = useRef(null);
  const [locationBindingError, setLocationBindingError] = useState('');
  const [locationBindingSaving, setLocationBindingSaving] = useState(false);
  const [captureDevice, setCaptureDevice] = useState(null);
  const [captureResult, setCaptureResult] = useState(null);
  const [captureError, setCaptureError] = useState('');
  const [captureRunning, setCaptureRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setActiveSection(initialSection);
    if (initialSection === 'mikrotik-settings') setDeviceTab('API');
    if (initialSection === 'olt-settings') setDeviceTab('SNMP');
    setSearch('');
    setOnuStatusFilter('');
    setOnuOltFilter('');
    setOnuPonFilter('');
    setNapOltFilter('');
    setNapPonFilter('');
    setNapStatusFilter('');
    setMapOltFilter('');
    setMapTypeFilter('');
    setPppoeStatusFilter('');
    setPppoeRouterFilter('');
    setPppoeProfileFilter('');
    setPppoePage(1);
  }, [initialSection]);

  async function load() {
    setError('');
    try {
      const [nextMeta, nextOverview, nextOlts, nextPons, nextNaps, nextFbts, nextOnus, nextDevices, nextMapImages] = await Promise.all([
        request('/network-settings/meta'),
        request('/network-settings/overview'),
        request('/network-settings/olts'),
        request('/network-settings/pons'),
        request('/network-settings/nap-boxes'),
        request('/network-settings/fbts'),
        request('/network-settings/onus'),
        request('/network-settings/devices'),
        request('/system-settings/map-images').catch(() => null)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setOlts(nextOlts);
      setPons(nextPons);
      setNaps(uniqueNapRows(nextNaps));
      setFbts(nextFbts);
      setOnus(nextOnus);
      setDevices(nextDevices);
      if (nextMapImages) setMapImages(nextMapImages);
      setSelectedOltId((current) => (current && nextOlts.some((olt) => olt.id === current) ? current : nextOlts[0]?.id || ''));
      setExpandedOltIds((current) => Object.fromEntries(
        Object.entries(current).filter(([id, expanded]) => expanded && nextOlts.some((olt) => olt.id === id))
      ));
      setExpandedNapOltIds((current) => Object.fromEntries(
        Object.entries(current).filter(([id, expanded]) => expanded && nextOlts.some((olt) => olt.id === id))
      ));
      setExpandedNapPonIds((current) => Object.fromEntries(
        Object.entries(current).filter(([id, expanded]) => expanded && nextPons.some((pon) => pon.id === id))
      ));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function loadPppoeAccounts() {
    setPppoeLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (pppoeRouterFilter) params.set('deviceId', pppoeRouterFilter);
      const nextPppoe = await request(`/network-settings/pppoe-accounts${params.toString() ? `?${params.toString()}` : ''}`);
      setPppoeAccounts(nextPppoe.accounts || []);
      setPppoeKpis(nextPppoe.kpis || {});
      setPppoeRouters(nextPppoe.routers || []);
      setPppoeProfiles(nextPppoe.profiles || []);
      setPppoeDeviceErrors(nextPppoe.deviceErrors || []);
      setPppoeCapturedAt(nextPppoe.capturedAt || '');
      setPppoePage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setPppoeLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === 'pppoe') loadPppoeAccounts();
  }, [activeSection, pppoeRouterFilter]);

  useEffect(() => {
    if (activeSection !== 'pppoe') return undefined;
    const timer = window.setInterval(() => {
      loadPppoeAccounts();
    }, PPPOE_AUTO_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [activeSection, pppoeRouterFilter]);

  useEffect(() => {
    if (activeSection !== 'onus') return undefined;
    const refreshSeconds = Number(meta.onuTableRefreshSeconds || ONU_AUTO_REFRESH_SECONDS);
    const timer = window.setInterval(() => {
      load();
    }, Math.max(5, refreshSeconds) * 1000);
    return () => window.clearInterval(timer);
  }, [activeSection, meta.onuTableRefreshSeconds]);

  useEffect(() => {
    if (onuPonFilter && !pons.some((pon) => pon.id === onuPonFilter && (!onuOltFilter || pon.oltId === onuOltFilter))) {
      setOnuPonFilter('');
    }
  }, [onuOltFilter, onuPonFilter, pons]);

  useEffect(() => {
    if (napPonFilter && !pons.some((pon) => pon.id === napPonFilter && (!napOltFilter || pon.oltId === napOltFilter))) {
      setNapPonFilter('');
    }
  }, [napOltFilter, napPonFilter, pons]);

  useEffect(() => {
    setPppoePage(1);
  }, [search, pppoeStatusFilter, pppoeProfileFilter, pppoePageSize]);

  useEffect(() => {
    if (activeSection !== 'map') return undefined;
    const node = mapSurfaceRef.current;
    if (!node) return undefined;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || DEFAULT_MAP_SURFACE.width));
      const height = Math.max(320, Math.round(rect.height || DEFAULT_MAP_SURFACE.height));
      setMapSurfaceSize((current) => {
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };
    updateSize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (observer) observer.observe(node);
    window.addEventListener('resize', updateSize);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [activeSection]);

  useEffect(() => {
    if (!oltLocationPickerOpen) return undefined;
    const node = oltLocationPickerSurfaceRef.current;
    if (!node) return undefined;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(300, Math.round(rect.width || DEFAULT_OLT_LOCATION_PICKER_SURFACE.width));
      const height = Math.max(260, Math.round(rect.height || DEFAULT_OLT_LOCATION_PICKER_SURFACE.height));
      setOltLocationPickerSurfaceSize((current) => {
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };
    updateSize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (observer) observer.observe(node);
    window.addEventListener('resize', updateSize);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [oltLocationPickerOpen]);

  const deviceScope = useMemo(() => {
    if (activeSection === 'mikrotik-settings') {
      return {
        accessMethod: 'API',
        deviceType: 'MIKROTIK',
        pageTitle: 'MikroTik API',
        subtitle: 'API-managed MikroTik routers used for PPPoE account discovery and future provisioning.',
        cardTitle: 'MikroTik API Devices',
        placeholder: 'Search MikroTik, IP, model',
        newLabel: 'New MikroTik',
        emptyMessage: 'No MikroTik API devices match the current search.',
        icon: IconRouter
      };
    }
    if (activeSection === 'olt-settings') {
      return {
        accessMethod: 'SNMP',
        deviceType: 'OLT',
        pageTitle: 'OLT SNMP',
        subtitle: 'SNMP-managed OLT devices used for capture, polling, and OLT/PON/ONU discovery.',
        cardTitle: 'OLT SNMP Devices',
        placeholder: 'Search OLT, IP, vendor, model',
        newLabel: 'New OLT SNMP',
        emptyMessage: 'No OLT SNMP devices match the current search.',
        icon: IconServer2
      };
    }
    return {
      accessMethod: deviceTab,
      deviceType: '',
      pageTitle: 'Devices',
      subtitle: '',
      cardTitle: `${deviceTab} Devices`,
      placeholder: 'Search device, IP, model',
      newLabel: 'New Device',
      emptyMessage: `No ${deviceTab} devices match the current search.`,
      icon: IconNetwork
    };
  }, [activeSection, deviceTab]);

  const filteredOlts = useMemo(
    () => olts.filter((olt) => matches(olt, search) || pons.some((pon) => pon.oltId === olt.id && matches(pon, search))),
    [olts, pons, search]
  );
  const filteredNaps = useMemo(
    () => naps.filter((nap) => (
      matches(nap, search)
      && (!napOltFilter || nap.oltId === napOltFilter)
      && (!napPonFilter || nap.ponPortId === napPonFilter)
      && (!napStatusFilter || nap.status === napStatusFilter)
    )),
    [naps, search, napOltFilter, napPonFilter, napStatusFilter]
  );
  const filteredFbts = useMemo(() => fbts.filter((fbt) => matches(fbt, search)), [fbts, search]);
  const barangayOptions = useMemo(() => {
    const values = new Set();
    [...locations, ...naps].forEach((item) => {
      const value = String(item.barangay || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [locations, naps]);
  const napPonOptions = useMemo(
    () => pons.filter((pon) => pon.oltId === napSelectedOltId),
    [pons, napSelectedOltId]
  );
  const napFilterPonOptions = useMemo(
    () => pons.filter((pon) => !napOltFilter || pon.oltId === napOltFilter),
    [pons, napOltFilter]
  );
  const napGroupsByOlt = useMemo(
    () => olts.map((olt) => {
      const oltNaps = filteredNaps.filter((nap) => nap.oltId === olt.id);
      const activeCount = oltNaps.filter((nap) => nap.status === 'ACTIVE').length;
      const ponGroups = pons
        .filter((pon) => pon.oltId === olt.id)
        .map((pon) => {
          const ponNaps = oltNaps.filter((nap) => nap.ponPortId === pon.id);
          return {
            pon,
            naps: ponNaps,
            activeCount: ponNaps.filter((nap) => nap.status === 'ACTIVE').length,
            fbtCount: ponNaps.reduce((total, nap) => total + Number(nap.fbtCount || 0), 0)
          };
        })
        .filter((group) => group.naps.length || (napPonFilter && group.pon.id === napPonFilter));
      return { olt, naps: oltNaps, ponGroups, activeCount, ponCount: ponGroups.length };
    }).filter((group) => group.naps.length || (napOltFilter && group.olt.id === napOltFilter)),
    [olts, pons, filteredNaps, napOltFilter, napPonFilter]
  );
  const filteredOnus = useMemo(
    () => onus.filter((onu) => (
      matches(onu, search)
      && (!onuStatusFilter || onu.status === onuStatusFilter)
      && (!onuOltFilter || onu.oltId === onuOltFilter)
      && (!onuPonFilter || onu.ponPortId === onuPonFilter)
    )),
    [onus, search, onuStatusFilter, onuOltFilter, onuPonFilter]
  );
  const filteredDevices = useMemo(
    () => devices.filter((device) => (
      device.accessMethod === deviceScope.accessMethod
      && (!deviceScope.deviceType || device.deviceType === deviceScope.deviceType)
      && matches(device, search)
    )),
    [devices, deviceScope.accessMethod, deviceScope.deviceType, search]
  );
  const filteredPppoeAccounts = useMemo(
    () => pppoeAccounts.filter((account) => (
      matches(account, search)
      && (!pppoeStatusFilter || account.status === pppoeStatusFilter)
      && (!pppoeProfileFilter || account.profile === pppoeProfileFilter)
    )),
    [pppoeAccounts, search, pppoeStatusFilter, pppoeProfileFilter]
  );
  const sortedPppoeAccounts = useMemo(() => {
    const direction = pppoeSort.direction === 'desc' ? -1 : 1;
    return [...filteredPppoeAccounts].sort((left, right) => {
      const leftValue = String(left[pppoeSort.key] ?? '').toLowerCase();
      const rightValue = String(right[pppoeSort.key] ?? '').toLowerCase();
      if (leftValue < rightValue) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      return String(left.username || '').localeCompare(String(right.username || ''));
    });
  }, [filteredPppoeAccounts, pppoeSort]);
  const pppoeTotalPages = Math.max(1, Math.ceil(sortedPppoeAccounts.length / Number(pppoePageSize || 25)));
  const pppoeCurrentPage = Math.min(pppoePage, pppoeTotalPages);
  const pagedPppoeAccounts = sortedPppoeAccounts.slice((pppoeCurrentPage - 1) * pppoePageSize, pppoeCurrentPage * pppoePageSize);
  const networkMap = useMemo(() => {
    const surface = {
      width: Math.max(320, Number(mapSurfaceSize.width) || DEFAULT_MAP_SURFACE.width),
      height: Math.max(320, Number(mapSurfaceSize.height) || DEFAULT_MAP_SURFACE.height)
    };
    const canvas = { width: Math.max(1600, surface.width), height: Math.max(1000, surface.height) };
    const mapScale = clamp(Number(mapView.zoom) || 1, MAP_MIN_SCALE, MAP_MAX_SCALE);
    const panX = Number(mapView.panX) || 0;
    const panY = Number(mapView.panY) || 0;
    const mapNaps = naps.filter((nap) => (
      matches(nap, search)
      && (!mapOltFilter || nap.oltId === mapOltFilter)
    ));
    const mapOlts = olts.filter((olt) => (
      (!mapOltFilter || olt.id === mapOltFilter)
      && (matches(olt, search) || mapNaps.some((nap) => nap.oltId === olt.id) || !String(search || '').trim())
    ));
    const showOltMarkers = mapLayerVisibility.olts && (!mapTypeFilter || mapTypeFilter === 'olt');
    const showNapMarkers = mapLayerVisibility.naps && (!mapTypeFilter || mapTypeFilter === 'nap');
    const coordinateRows = [
      ...(showOltMarkers ? mapOlts.filter(hasCoordinates) : []),
      ...(showNapMarkers ? mapNaps.filter(hasCoordinates) : [])
    ];
    const geoPoints = coordinateRows
      .map((row) => ({ lat: parseCoordinate(row.latitude), lng: parseCoordinate(row.longitude) }))
      .filter((point) => point.lat !== null && point.lng !== null);
    const mapCenter = geoPoints.length
      ? {
        lat: geoPoints.reduce((total, point) => total + point.lat, 0) / geoPoints.length,
        lng: geoPoints.reduce((total, point) => total + point.lng, 0) / geoPoints.length
      }
      : { lat: 14.5995, lng: 120.9842 };
    let baseZoom = geoPoints.length > 1 ? 16 : 17;
    if (geoPoints.length > 1) {
      for (let candidateZoom = 18; candidateZoom >= 10; candidateZoom -= 1) {
        const projected = geoPoints.map((point) => geoToWorldPixel(point.lat, point.lng, candidateZoom));
        const xs = projected.map((point) => point.x);
        const ys = projected.map((point) => point.y);
        if ((Math.max(...xs) - Math.min(...xs)) <= canvas.width - 320 && (Math.max(...ys) - Math.min(...ys)) <= canvas.height - 260) {
          baseZoom = candidateZoom;
          break;
        }
      }
    }
    const centerWorld = geoToWorldPixel(mapCenter.lat, mapCenter.lng, baseZoom);
    const tileBoost = Math.max(0, Math.floor(Math.log2(Math.max(mapScale, 1))));
    const detailBoost = mapHighDetail && mapScale >= 0.85 ? 1 : 0;
    const tileZoom = clamp(baseZoom + tileBoost + detailBoost, 1, MAP_MAX_NATIVE_TILE_ZOOM);
    const tileZoomRatio = 2 ** (tileZoom - baseZoom);
    const tileScale = mapScale / tileZoomRatio;
    const tileCenterWorld = {
      x: centerWorld.x * tileZoomRatio,
      y: centerWorld.y * tileZoomRatio
    };
    const screenPoint = (point) => ({
      x: surface.width / 2 + (point.x - canvas.width / 2) * mapScale + panX,
      y: surface.height / 2 + (point.y - canvas.height / 2) * mapScale + panY
    });
    const tileWorldToScreen = (world) => ({
      x: surface.width / 2 + (world.x - tileCenterWorld.x) * tileScale + panX,
      y: surface.height / 2 + (world.y - tileCenterWorld.y) * tileScale + panY
    });
    const visibleTileWorld = {
      left: tileCenterWorld.x + (0 - surface.width / 2 - panX) / tileScale,
      right: tileCenterWorld.x + (surface.width - surface.width / 2 - panX) / tileScale,
      top: tileCenterWorld.y + (0 - surface.height / 2 - panY) / tileScale,
      bottom: tileCenterWorld.y + (surface.height - surface.height / 2 - panY) / tileScale
    };
    const tileStartX = Math.floor(visibleTileWorld.left / 256) - 2;
    const tileEndX = Math.floor(visibleTileWorld.right / 256) + 2;
    const tileStartY = Math.max(0, Math.floor(visibleTileWorld.top / 256) - 2);
    const tileEndY = Math.min((2 ** tileZoom) - 1, Math.floor(visibleTileWorld.bottom / 256) + 2);
    const tiles = [];
    for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
      for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
        const tilePoint = tileWorldToScreen({ x: tileX * 256, y: tileY * 256 });
        tiles.push({
          id: `${tileZoom}-${tileX}-${tileY}`,
          src: mapTileUrl(tileX, tileY, tileZoom),
          x: tilePoint.x,
          y: tilePoint.y,
          size: 256 * tileScale
        });
      }
    }
    const project = (row) => {
      const lat = parseCoordinate(row.latitude);
      const lng = parseCoordinate(row.longitude);
      if (lat === null || lng === null) return null;
      const world = geoToWorldPixel(lat, lng, baseZoom);
      return {
        x: canvas.width / 2 + world.x - centerWorld.x,
        y: canvas.height / 2 + world.y - centerWorld.y,
        coordinateSource: 'GPS'
      };
    };
    const oltPositions = new Map();
    const gridColumns = Math.max(1, Math.ceil(Math.sqrt(Math.max(mapOlts.length, 1))));
    mapOlts.forEach((olt, index) => {
      const projected = project(olt);
      if (projected) {
        oltPositions.set(olt.id, projected);
        return;
      }
      const childPositions = mapNaps
        .filter((nap) => nap.oltId === olt.id)
        .map(project)
        .filter(Boolean);
      if (childPositions.length) {
        oltPositions.set(olt.id, {
          x: childPositions.reduce((total, item) => total + item.x, 0) / childPositions.length,
          y: childPositions.reduce((total, item) => total + item.y, 0) / childPositions.length - 70,
          coordinateSource: 'NAP centroid'
        });
        return;
      }
      const column = index % gridColumns;
      const row = Math.floor(index / gridColumns);
      const xStep = gridColumns <= 1 ? 0 : (canvas.width - 320) / (gridColumns - 1);
      oltPositions.set(olt.id, {
        x: 160 + column * xStep,
        y: 150 + row * 230,
        coordinateSource: 'Topology'
      });
    });
    const napSiblingIndexes = new Map();
    const napPositions = new Map();
    mapNaps.forEach((nap) => {
      const projected = project(nap);
      if (projected) {
        napPositions.set(nap.id, projected);
        return;
      }
      const parent = oltPositions.get(nap.oltId) || { x: canvas.width / 2, y: canvas.height / 2 };
      const siblings = mapNaps.filter((row) => row.oltId === nap.oltId && !hasCoordinates(row));
      const index = napSiblingIndexes.get(nap.oltId) || 0;
      napSiblingIndexes.set(nap.oltId, index + 1);
      const total = Math.max(1, siblings.length);
      const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
      const radius = 110 + (index % 3) * 28;
      napPositions.set(nap.id, {
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius,
        coordinateSource: 'Topology'
      });
    });
    const oltNodes = mapOlts.map((olt) => ({
      id: `olt-${olt.id}`,
      sourceId: olt.id,
      type: 'olt',
      label: olt.name,
      detail: [olt.vendor, olt.model || olt.managementIp].filter(Boolean).join(' / ') || 'OLT',
      status: olt.status,
      napCount: mapNaps.filter((nap) => nap.oltId === olt.id).length,
      ...oltPositions.get(olt.id)
    })).filter((node) => node.x !== undefined && node.y !== undefined);
    const napNodes = mapNaps.map((nap) => ({
      id: `nap-${nap.id}`,
      sourceId: nap.id,
      parentOltId: nap.oltId,
      type: 'nap',
      label: nap.name,
      detail: [nap.oltName, nap.ponLabel, nap.barangay].filter(Boolean).join(' / ') || 'NAP Box',
      status: nap.status,
      splitterRatio: formatSplitterRatio(nap.splitterRatio),
      fbtCount: nap.fbtCount,
      ...napPositions.get(nap.id)
    })).filter((node) => node.x !== undefined && node.y !== undefined);
    const nodes = [
      ...(showOltMarkers ? oltNodes : []),
      ...(showNapMarkers ? napNodes : [])
    ].map((node) => ({ ...node, ...screenPoint(node) }));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const showLinks = mapLayerVisibility.links && showOltMarkers && showNapMarkers;
    const lines = !showLinks ? [] : mapNaps.map((nap) => {
      const parent = oltPositions.get(nap.oltId);
      const child = napPositions.get(nap.id);
      if (!parent || !child) return null;
      const parentPoint = screenPoint(parent);
      const childPoint = screenPoint(child);
      return {
        id: `${nap.oltId}-${nap.id}`,
        x1: parentPoint.x,
        y1: parentPoint.y,
        x2: childPoint.x,
        y2: childPoint.y,
        visible: visibleNodeIds.has(`olt-${nap.oltId}`) && visibleNodeIds.has(`nap-${nap.id}`)
      };
    }).filter((line) => line?.visible);
    return {
      canvas,
      surface,
      nodes,
      lines,
      tiles,
      baseZoom,
      tileZoom,
      viewZoom: baseZoom + Math.log2(mapScale),
      nativeTileMaxed: tileZoom >= MAP_MAX_NATIVE_TILE_ZOOM,
      mapMode: geoPoints.length ? 'GPS map' : 'Topology',
      totals: {
        olts: nodes.filter((node) => node.type === 'olt').length,
        naps: nodes.filter((node) => node.type === 'nap').length,
        gps: nodes.filter((node) => node.coordinateSource === 'GPS').length
      }
    };
  }, [olts, naps, search, mapOltFilter, mapTypeFilter, mapSurfaceSize, mapView, mapHighDetail, mapLayerVisibility]);
  const oltLocationPickerMap = useMemo(() => {
    const surface = {
      width: Math.max(300, Number(oltLocationPickerSurfaceSize.width) || DEFAULT_OLT_LOCATION_PICKER_SURFACE.width),
      height: Math.max(260, Number(oltLocationPickerSurfaceSize.height) || DEFAULT_OLT_LOCATION_PICKER_SURFACE.height)
    };
    const zoom = clamp(Math.round(Number(oltLocationPickerView.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom), 10, 19);
    const centerWorld = geoToWorldPixel(oltLocationPickerView.lat, oltLocationPickerView.lng, zoom);
    const visibleWorld = {
      left: centerWorld.x - surface.width / 2,
      right: centerWorld.x + surface.width / 2,
      top: centerWorld.y - surface.height / 2,
      bottom: centerWorld.y + surface.height / 2
    };
    const tileStartX = Math.floor(visibleWorld.left / 256) - 1;
    const tileEndX = Math.floor(visibleWorld.right / 256) + 1;
    const tileStartY = Math.max(0, Math.floor(visibleWorld.top / 256) - 1);
    const tileEndY = Math.min((2 ** zoom) - 1, Math.floor(visibleWorld.bottom / 256) + 1);
    const tiles = [];
    for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
      for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
        tiles.push({
          id: `${zoom}-${tileX}-${tileY}`,
          src: mapTileUrl(tileX, tileY, zoom),
          x: surface.width / 2 + tileX * 256 - centerWorld.x,
          y: surface.height / 2 + tileY * 256 - centerWorld.y
        });
      }
    }
    const selectedLat = parseCoordinate(oltLocationForm.latitude);
    const selectedLng = parseCoordinate(oltLocationForm.longitude);
    const marker = selectedLat !== null && selectedLng !== null
      ? (() => {
        const selectedWorld = geoToWorldPixel(selectedLat, selectedLng, zoom);
        return {
          x: surface.width / 2 + selectedWorld.x - centerWorld.x,
          y: surface.height / 2 + selectedWorld.y - centerWorld.y
        };
      })()
      : null;
    return { surface, zoom, centerWorld, tiles, marker };
  }, [oltLocationForm.latitude, oltLocationForm.longitude, oltLocationPickerSurfaceSize, oltLocationPickerView]);

  function ponsForOlt(olt) {
    const oltPons = pons.filter((pon) => pon.oltId === olt.id);
    if (!String(search || '').trim() || matches(olt, search)) return oltPons;
    return oltPons.filter((pon) => matches(pon, search));
  }

  function onusForPon(ponId) {
    return onus.filter((onu) => onu.ponPortId === ponId);
  }

  function togglePppoeSort(key) {
    setPppoeSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function pppoeSortLabel(key) {
    if (pppoeSort.key !== key) return '';
    return pppoeSort.direction === 'asc' ? ' asc' : ' desc';
  }

  function toggleOltExpansion(oltId) {
    setSelectedOltId(oltId);
    setExpandedOltIds((current) => ({ ...current, [oltId]: !current[oltId] }));
  }

  function toggleNapOltExpansion(oltId) {
    setExpandedNapOltIds((current) => ({ ...current, [oltId]: !current[oltId] }));
  }

  function toggleNapPonExpansion(ponId) {
    setExpandedNapPonIds((current) => ({ ...current, [ponId]: !current[ponId] }));
  }

  function zoomMapAt(multiplier, clientX = null, clientY = null) {
    const surfaceNode = mapSurfaceRef.current;
    const rect = surfaceNode?.getBoundingClientRect();
    const surfaceWidth = rect?.width || mapSurfaceSize.width || DEFAULT_MAP_SURFACE.width;
    const surfaceHeight = rect?.height || mapSurfaceSize.height || DEFAULT_MAP_SURFACE.height;
    const pointX = rect && clientX !== null ? clientX - rect.left : surfaceWidth / 2;
    const pointY = rect && clientY !== null ? clientY - rect.top : surfaceHeight / 2;

    setMapView((current) => {
      const currentZoom = clamp(Number(current.zoom) || 1, MAP_MIN_SCALE, MAP_MAX_SCALE);
      const nextZoom = clamp(Number((currentZoom * multiplier).toFixed(4)), MAP_MIN_SCALE, MAP_MAX_SCALE);
      if (nextZoom === currentZoom) return current;
      const ratio = nextZoom / currentZoom;
      const panX = Number(current.panX) || 0;
      const panY = Number(current.panY) || 0;
      const anchorX = pointX - surfaceWidth / 2;
      const anchorY = pointY - surfaceHeight / 2;
      return {
        ...current,
        zoom: nextZoom,
        panX: anchorX - (anchorX - panX) * ratio,
        panY: anchorY - (anchorY - panY) * ratio
      };
    });
  }

  function resetMapView() {
    setMapView({ zoom: 1, panX: 0, panY: 0 });
  }

  function toggleMapLayer(layerKey) {
    setMapLayerVisibility((current) => ({ ...current, [layerKey]: !current[layerKey] }));
  }

  function startMapPan(event) {
    if (event.button !== 0) return;
    mapDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: mapView.panX,
      panY: mapView.panY
    };
    setMapDragging(true);
  }

  function moveMapPan(event) {
    if (!mapDragRef.current) return;
    const { x, y, panX, panY } = mapDragRef.current;
    setMapView((current) => ({
      ...current,
      panX: panX + event.clientX - x,
      panY: panY + event.clientY - y
    }));
  }

  function endMapPan() {
    mapDragRef.current = null;
    setMapDragging(false);
  }

  function mapImageFor(targetId) {
    return mapImages?.targets?.find((target) => target.id === targetId)?.image?.data_url || '';
  }

  function openOltLocationCapture() {
    setOltLocationPickerView((current) => oltPickerViewFromCoordinates(oltLocationForm.latitude, oltLocationForm.longitude, current));
    setOltLocationPickerOpen(true);
  }

  function updateOltLocationPickerZoom(delta) {
    setOltLocationPickerView((current) => ({
      ...current,
      zoom: clamp(Math.round((Number(current.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom) + delta), 10, 19)
    }));
  }

  function captureOltLocationAtPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const zoom = clamp(Math.round(Number(oltLocationPickerView.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom), 10, 19);
    const centerWorld = geoToWorldPixel(oltLocationPickerView.lat, oltLocationPickerView.lng, zoom);
    const captured = worldPixelToGeo(
      centerWorld.x + x - rect.width / 2,
      centerWorld.y + y - rect.height / 2,
      zoom
    );
    setOltLocationForm((current) => ({
      ...current,
      latitude: captured.latitude.toFixed(6),
      longitude: captured.longitude.toFixed(6)
    }));
    setOltLocationPickerView((current) => ({
      ...current,
      lat: captured.latitude,
      lng: captured.longitude,
      zoom
    }));
  }

  function startOltLocationPickerPan(event) {
    if (event.button !== 0) return;
    oltLocationPickerDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      view: oltLocationPickerView,
      moved: false
    };
    setOltLocationPickerDragging(true);
  }

  function moveOltLocationPickerPan(event) {
    const drag = oltLocationPickerDragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const startWorld = geoToWorldPixel(drag.view.lat, drag.view.lng, drag.view.zoom);
    const nextCenter = worldPixelToGeo(startWorld.x - dx, startWorld.y - dy, drag.view.zoom);
    setOltLocationPickerView({
      ...drag.view,
      lat: nextCenter.latitude,
      lng: nextCenter.longitude
    });
  }

  function finishOltLocationPickerPan(event) {
    const drag = oltLocationPickerDragRef.current;
    if (!drag) return;
    oltLocationPickerDragRef.current = null;
    setOltLocationPickerDragging(false);
    if (!drag.moved) captureOltLocationAtPointer(event);
  }

  function cancelOltLocationPickerPan() {
    oltLocationPickerDragRef.current = null;
    setOltLocationPickerDragging(false);
  }

  function closeModal() {
    setModalType('');
    setDeviceFormError('');
    setDeviceSaving(false);
    setNapSelectedOltId('');
    setNapAddAnother(false);
    setNapFormMessage('');
    setNapFormError('');
    setNapSaving(false);
    setLocationBindingDevice(null);
    setLocationBindingSelection([]);
    setOltLocationForm({ locationId: '', label: '', latitude: '', longitude: '' });
    setOltLocationPickerOpen(false);
    setOltLocationPickerView(DEFAULT_OLT_LOCATION_PICKER);
    setOltLocationPickerDragging(false);
    oltLocationPickerDragRef.current = null;
    setLocationBindingError('');
    setLocationBindingSaving(false);
  }

  function closeCaptureModal() {
    setCaptureDevice(null);
    setCaptureResult(null);
    setCaptureError('');
    setCaptureRunning(false);
  }

  function openCaptureDevice(device) {
    setCaptureDevice(device);
    setCaptureResult(device.lastCapture || null);
    setCaptureError('');
    setCaptureRunning(false);
  }

  function openEditOlt(olt) {
    setOltForm({ ...blankOlt, ...olt, defaultPonCount: String(olt.defaultPonCount) });
    setModalType('olt');
  }

  function openNewPon(oltId = selectedOltId) {
    const nextOltId = oltId || selectedOltId;
    if (nextOltId) {
      setSelectedOltId(nextOltId);
      setExpandedOltIds((current) => ({ ...current, [nextOltId]: true }));
    }
    setPonForm(blankPon);
    setModalType('pon');
  }

  function openEditPon(pon) {
    setSelectedOltId(pon.oltId);
    setExpandedOltIds((current) => ({ ...current, [pon.oltId]: true }));
    setPonForm({ ...blankPon, ...pon, portNumber: String(pon.portNumber), capacity: String(pon.capacity) });
    setModalType('pon');
  }

  function openPonPower(pon) {
    setSelectedOltId(pon.oltId);
    setExpandedOltIds((current) => ({ ...current, [pon.oltId]: true }));
    setPonForm({ ...blankPon, ...pon, portNumber: String(pon.portNumber), capacity: String(pon.capacity), moduleSource: pon.moduleSource || 'Manual' });
    setModalType('pon-power');
  }

  function loadBarangayOptions() {
    request('/system-settings/locations')
      .then(setLocations)
      .catch(() => setLocations([]));
  }

  function openNewNap() {
    setNapForm(blankNap);
    setNapSelectedOltId('');
    setNapAddAnother(false);
    setNapFormMessage('');
    setNapFormError('');
    setNapSaving(false);
    setModalType('nap');
    loadBarangayOptions();
  }

  function openEditNap(nap) {
    const assignedPon = pons.find((pon) => pon.id === nap.ponPortId);
    setNapForm({ ...blankNap, ...nap, splitterRatio: normalizeNapSplitterRatio(nap.splitterRatio), portCapacity: String(nap.portCapacity) });
    setNapSelectedOltId(assignedPon?.oltId || nap.oltId || '');
    setNapAddAnother(false);
    setNapFormMessage('');
    setNapFormError('');
    setNapSaving(false);
    setModalType('nap');
    loadBarangayOptions();
  }

  function selectNapOlt(oltId) {
    setNapSelectedOltId(oltId);
    setNapFormMessage('');
    setNapFormError('');
    setNapForm((current) => {
      const currentPonStillAvailable = pons.some((pon) => pon.id === current.ponPortId && pon.oltId === oltId);
      return { ...current, ponPortId: currentPonStillAvailable ? current.ponPortId : '' };
    });
  }

  function selectNapPon(ponPortId) {
    setNapFormMessage('');
    setNapFormError('');
    setNapForm((current) => ({ ...current, ponPortId }));
  }

  function openNewFbt() {
    setFbtForm(blankFbt);
    setModalType('fbt');
  }

  function openEditFbt(fbt) {
    setFbtForm({ ...blankFbt, ...fbt, portNumber: String(fbt.portNumber), portCapacity: String(fbt.portCapacity) });
    setModalType('fbt');
  }

  function openNewDevice() {
    setDeviceForm({
      ...blankDevice,
      accessMethod: deviceScope.accessMethod,
      deviceType: deviceScope.deviceType,
      snmpPort: '161',
      snmpVersion: 'V2C',
      snmpTransport: 'UDP',
      portAssociationMode: 'IFINDEX',
      pollerGroup: '0',
      forceAdd: false
    });
    setDeviceFormError('');
    setModalType('device');
  }

  function openEditDevice(device) {
    setDeviceTab(device.accessMethod || 'API');
    setDeviceFormError('');
    setDeviceForm({
      ...blankDevice,
      ...device,
      apiPort: String(device.apiPort || ''),
      apiPassword: '',
      snmpPort: String(device.snmpPort || ''),
      snmpCommunity: '',
      snmpAuthPassword: '',
      snmpPrivacyPassword: '',
      forceAdd: Boolean(device.forceAdd)
    });
    setModalType('device');
  }

  function openLocationBindings(device) {
    const selectedLocationId = device.oltLocationId || device.oltLocation?.id || '';
    const latitude = device.latitude || device.oltLocation?.latitude || '';
    const longitude = device.longitude || device.oltLocation?.longitude || '';
    setLocationBindingDevice(device);
    setLocationBindingSelection(isSnmpOltDevice(device) ? (selectedLocationId ? [selectedLocationId] : []) : (device.boundLocationIds || []));
    setOltLocationForm({
      locationId: selectedLocationId,
      label: device.oltLocationName || device.oltLocation?.label || device.site || '',
      latitude,
      longitude
    });
    setOltLocationPickerOpen(false);
    setOltLocationPickerView(oltPickerViewFromCoordinates(latitude, longitude));
    setLocationBindingError('');
    setLocationBindingSaving(false);
    setModalType('location-bindings');
    loadBarangayOptions();
  }

  function selectOltLocation(locationId) {
    const location = locations.find((row) => row.id === locationId);
    setLocationBindingSelection(locationId ? [locationId] : []);
    setOltLocationForm((current) => ({
      ...current,
      locationId,
      label: location ? locationLabel(location) : current.label,
      latitude: location?.latitude ?? current.latitude,
      longitude: location?.longitude ?? current.longitude
    }));
    if (location && hasCoordinates(location)) {
      setOltLocationPickerView((current) => oltPickerViewFromCoordinates(location.latitude, location.longitude, current));
    }
  }

  function toggleLocationBinding(locationId, checked) {
    setLocationBindingSelection((current) => {
      if (checked) return current.includes(locationId) ? current : [...current, locationId];
      return current.filter((id) => id !== locationId);
    });
  }

  async function saveLocationBindings(event) {
    event.preventDefault();
    if (!locationBindingDevice) return;
    setLocationBindingError('');
    setLocationBindingSaving(true);
    try {
      if (isSnmpOltDevice(locationBindingDevice)) {
        const selectedLocation = locations.find((location) => location.id === oltLocationForm.locationId);
        const saved = await request(`/network-settings/devices/${locationBindingDevice.id}/olt-location`, {
          method: 'PATCH',
          body: JSON.stringify({
            locationId: oltLocationForm.locationId,
            label: oltLocationForm.label,
            latitude: oltLocationForm.latitude,
            longitude: oltLocationForm.longitude,
            location: selectedLocation ? {
              id: selectedLocation.id,
              location_name: selectedLocation.location_name,
              address: selectedLocation.address,
              municipality: selectedLocation.municipality,
              barangay: selectedLocation.barangay,
              province: selectedLocation.province,
              region: selectedLocation.region,
              latitude: selectedLocation.latitude,
              longitude: selectedLocation.longitude
            } : {}
          })
        });
        setMessage(`${saved.name} OLT map location saved.`);
        closeModal();
        await load();
        refreshShell();
        return;
      }
      const selectedLocations = locations
        .filter((location) => locationBindingSelection.includes(location.id))
        .map((location) => ({
          id: location.id,
          location_name: location.location_name,
          address: location.address,
          municipality: location.municipality,
          barangay: location.barangay,
          province: location.province,
          region: location.region,
          latitude: location.latitude,
          longitude: location.longitude
        }));
      const saved = await request(`/network-settings/devices/${locationBindingDevice.id}/location-bindings`, {
        method: 'PATCH',
        body: JSON.stringify({ locationIds: locationBindingSelection, locations: selectedLocations })
      });
      setMessage(`${saved.name} location bindings saved.`);
      closeModal();
      await load();
      refreshShell();
    } catch (err) {
      setLocationBindingError(err.message);
    } finally {
      setLocationBindingSaving(false);
    }
  }

  async function saveOlt(event) {
    event.preventDefault();
    const body = { ...oltForm, defaultPonCount: numberOrBlank(oltForm.defaultPonCount) };
    delete body.id;
    const saved = await request(oltForm.id ? `/network-settings/olts/${oltForm.id}` : '/network-settings/olts', {
      method: oltForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    setMessage(`${saved.name} saved.`);
    setSelectedOltId(saved.id);
    setExpandedOltIds((current) => ({ ...current, [saved.id]: true }));
    closeModal();
    await load();
    refreshShell();
  }

  async function savePon(event) {
    event.preventDefault();
    if (!selectedOltId && !ponForm.id) return;
    const body = { ...ponForm, portNumber: numberOrBlank(ponForm.portNumber), capacity: numberOrBlank(ponForm.capacity) };
    delete body.id;
    const path = ponForm.id ? `/network-settings/pons/${ponForm.id}` : `/network-settings/olts/${selectedOltId}/pons`;
    await request(path, { method: ponForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setMessage('PON saved.');
    closeModal();
    await load();
    refreshShell();
  }

  async function savePonPower(event) {
    event.preventDefault();
    if (!ponForm.id) return;
    const body = {
      moduleVendor: ponForm.moduleVendor,
      modulePartNumber: ponForm.modulePartNumber,
      moduleSerial: ponForm.moduleSerial,
      moduleHardwareRev: ponForm.moduleHardwareRev,
      moduleRxPowerDbm: ponForm.moduleRxPowerDbm,
      moduleTxPowerDbm: ponForm.moduleTxPowerDbm,
      moduleTemperatureC: ponForm.moduleTemperatureC,
      moduleVoltageV: ponForm.moduleVoltageV,
      moduleBiasCurrentMa: ponForm.moduleBiasCurrentMa,
      moduleSource: 'Manual'
    };
    await request(`/network-settings/pons/${ponForm.id}/power`, { method: 'PATCH', body: JSON.stringify(body) });
    setMessage('PON power saved.');
    closeModal();
    await load();
    refreshShell();
  }

  async function saveNap(event) {
    event.preventDefault();
    if (napSaving) return;
    if (!napSelectedOltId) {
      setNapFormError('Choose an OLT before saving the NAP box.');
      return;
    }
    if (!napForm.ponPortId) {
      setNapFormError('Choose a PON before saving the NAP box.');
      return;
    }
    setNapFormError('');
    setNapFormMessage('');
    setNapSaving(true);
    const body = { ...napForm, splitterRatio: normalizeNapSplitterRatio(napForm.splitterRatio) };
    delete body.id;
    delete body.oltId;
    delete body.portCapacity;
    body.location = '';
    try {
      const saved = await request(napForm.id ? `/network-settings/nap-boxes/${napForm.id}` : '/network-settings/nap-boxes', {
        method: napForm.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      setNaps((current) => uniqueNapRows([saved, ...current.filter((nap) => nap.id !== saved.id)]));
      const successMessage = `${saved.name} saved.`;
      setMessage(successMessage);
      if (!napForm.id && napAddAnother) {
        const retainedPonPortId = saved.ponPortId || body.ponPortId;
        const retainedPon = pons.find((pon) => pon.id === retainedPonPortId);
        setNapForm({ ...blankNap, ponPortId: retainedPonPortId });
        setNapFormMessage(`${successMessage} Add another NAP for ${retainedPon ? ponPathLabel(retainedPon, olts) : 'the selected PON'}.`);
      } else {
        closeModal();
      }
      request('/network-settings/overview').then(setOverview).catch((err) => setError(err.message));
      request('/network-settings/pons').then(setPons).catch((err) => setError(err.message));
      Promise.resolve(refreshShell()).catch(() => {});
    } catch (err) {
      setNapFormError(err.message);
    } finally {
      setNapSaving(false);
    }
  }

  async function saveFbt(event) {
    event.preventDefault();
    const body = { ...fbtForm, portNumber: numberOrBlank(fbtForm.portNumber), portCapacity: numberOrBlank(fbtForm.portCapacity) };
    delete body.id;
    await request(fbtForm.id ? `/network-settings/fbts/${fbtForm.id}` : '/network-settings/fbts', {
      method: fbtForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    setMessage('FBT saved.');
    closeModal();
    await load();
    refreshShell();
  }

  async function saveDevice(event) {
    event.preventDefault();
    setDeviceFormError('');
    if (!deviceForm.accessMethod) {
      setDeviceFormError('Choose an access method before saving.');
      return;
    }
    if (!deviceForm.deviceType) {
      setDeviceFormError('Choose a device type before saving.');
      return;
    }
    const body = { ...deviceForm, apiPort: numberOrBlank(deviceForm.apiPort), snmpPort: numberOrBlank(deviceForm.snmpPort) };
    delete body.id;
    delete body.vendor;
    delete body.model;
    delete body.apiProfile;
    delete body.notes;
    setDeviceSaving(true);
    try {
      const saved = await request(deviceForm.id ? `/network-settings/devices/${deviceForm.id}` : '/network-settings/devices', {
        method: deviceForm.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      setMessage(`${saved.name} saved.`);
      setDeviceTab(saved.accessMethod);
      closeModal();
      await load();
      refreshShell();
    } catch (err) {
      setDeviceFormError(err.message);
    } finally {
      setDeviceSaving(false);
    }
  }

  async function runCapture() {
    if (!captureDevice) return;
    setCaptureRunning(true);
    setCaptureError('');
    try {
      const result = await request(`/network-settings/devices/${captureDevice.id}/capture`, { method: 'POST' });
      setCaptureResult(result);
      setMessage(`${captureDevice.name} capture completed.`);
      await load();
      refreshShell();
    } catch (err) {
      setCaptureError(err.message);
    } finally {
      setCaptureRunning(false);
    }
  }

  async function remove(path, label) {
    if (!window.confirm(`Delete ${label}?`)) return;
    await request(path, { method: 'DELETE' });
    setMessage(`${label} deleted.`);
    await load();
    refreshShell();
  }

  function tableActions({ placeholder, onNew, newLabel }) {
    return (
      <div className="btn-list network-header-actions">
        <SearchInput value={search} onChange={setSearch} placeholder={placeholder} />
        <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Refresh" aria-label="Refresh" onClick={load}>
          <IconRefresh size={16} />
        </button>
        {onNew && (
          <button type="button" className="btn btn-primary btn-sm network-header-icon-button" title={newLabel} aria-label={newLabel} onClick={onNew}>
            <IconPlus size={16} />
          </button>
        )}
      </div>
    );
  }

  function renderOverview() {
    const metrics = [
      ['OLTs', overview.metrics.olts, IconWifi, 'blue'],
      ['PON Ports', overview.metrics.pon_ports, IconNetwork, 'azure'],
      ['ONUs', overview.metrics.onus, IconRouter, 'teal'],
      ['NAP Boxes', overview.metrics.nap_boxes, IconBox, 'orange'],
      ['FBTs', overview.metrics.fbts, IconNetwork, 'green']
    ];
    return (
      <>
        <PageHeader title="Overview" />
        <div className="row row-cards network-settings-page">
          {metrics.map(([label, value, Icon, tone]) => (
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
            <Card title="Network Nodes" icon={IconNetwork} className="network-table-card">
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table">
                  <thead><tr><th>OLT</th><th>Status</th><th>PON</th><th>NAP</th><th>FBT</th></tr></thead>
                  <tbody>
                    {overview.olts.map((olt) => (
                      <tr key={olt.id}>
                        <td><span className="network-table-value fw-semibold">{olt.name}</span><div className="text-muted small">{olt.site}</div></td>
                        <td><StatusBadge value={olt.status} /></td>
                        <td>{olt.ponCount}/{olt.defaultPonCount}</td>
                        <td>{olt.napCount}</td>
                        <td>{olt.fbtCount}</td>
                      </tr>
                    ))}
                    {!overview.olts.length && <tr><td colSpan="5"><div className="empty">No network records yet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderDevicesPage() {
    return (
      <>
        <PageHeader title={deviceScope.pageTitle} subtitle={deviceScope.subtitle} />
        <div className="row row-cards network-settings-page">
          <div className="col-12">
            <Card
              title={`${deviceScope.cardTitle} (${filteredDevices.length})`}
              icon={deviceScope.icon}
              className="network-table-card"
              actions={tableActions({ placeholder: deviceScope.placeholder, onNew: openNewDevice, newLabel: deviceScope.newLabel })}
            >
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-device-table">
                  <thead><tr><th>Device</th><th>Endpoint</th><th>Type</th><th>Vendor</th><th>Status</th><th>Polling</th><th className="network-actions-column">Actions</th></tr></thead>
                  <tbody>
                    {filteredDevices.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <span className="network-table-value fw-semibold">{device.name}</span>
                          <div className="text-muted small">{device.site}</div>
                          {device.deviceType === 'MIKROTIK' && (
                            <div className="text-muted small">
                              {device.locationBindingCount ? `${device.locationBindingCount} bound location${device.locationBindingCount === 1 ? '' : 's'}` : 'No location bindings'}
                            </div>
                          )}
                          {isSnmpOltDevice(device) && (
                            <div className="text-muted small">
                              {device.hasOltMapLocation ? `Map ${device.latitude}, ${device.longitude}` : 'No OLT map location'}
                            </div>
                          )}
                        </td>
                        <td>{device.connectionLabel}<span>{device.accessMethod === 'API' ? device.apiProtocol : `${titleize(device.snmpVersion)} / ${titleize(device.snmpTransport)} / ${titleize(device.portAssociationMode)}`}</span></td>
                        <td><span className={`badge ${device.deviceType === 'MIKROTIK' ? 'bg-blue-lt text-blue' : 'bg-indigo-lt text-indigo'}`}>{titleize(device.deviceType)}</span></td>
                        <td>{device.vendor || '-'}<span>{device.model || 'Model pending capture'}</span></td>
                        <td><StatusBadge value={device.status} /></td>
                        <td>
                          <span className="network-table-value fw-semibold">Every {device.pollIntervalLabel || formatSeconds(device.pollIntervalSeconds)}</span>
                          <span>{device.lastCapture ? `${titleize(device.lastCapture.status)} ${formatDateTime(device.lastCapture.capturedAt)}` : titleize(device.autodetectScope)}</span>
                        </td>
                        <RowActions
                          label={device.name}
                          onEdit={() => openEditDevice(device)}
                          onDelete={() => remove(`/network-settings/devices/${device.id}`, device.name)}
                          extraActions={[
                            ...(device.accessMethod === 'API' && device.deviceType === 'MIKROTIK' ? [{
                              label: 'bind-locations',
                              title: `Bind locations to ${device.name}`,
                              icon: IconMapPin,
                              className: 'bg-purple-lt text-purple',
                              onClick: () => openLocationBindings(device)
                            }] : []),
                            ...(isSnmpOltDevice(device) ? [{
                              label: 'bind-olt-location',
                              title: `Set OLT map location for ${device.name}`,
                              icon: IconMapPin,
                              className: 'bg-purple-lt text-purple',
                              onClick: () => openLocationBindings(device)
                            }] : []),
                            ...(device.accessMethod === 'SNMP' ? [{
                              label: 'capture',
                              title: `Capture ${device.name}`,
                              icon: IconRadar,
                              className: 'bg-green-lt text-green',
                              onClick: () => openCaptureDevice(device)
                            }] : [])
                          ]}
                        />
                      </tr>
                    ))}
                    {!filteredDevices.length && <tr><td colSpan="7"><div className="empty">{deviceScope.emptyMessage}</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderOltPonPage() {
    return (
      <>
        <PageHeader title="OLT & PON" />
        <div className="row row-cards network-settings-page">
          <div className="col-12">
            <Card
              title={`OLTs (${filteredOlts.length})`}
              icon={IconWifi}
              className="network-table-card"
              actions={tableActions({ placeholder: 'Search OLT, site, IP' })}
            >
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-olt-pon-table">
                  <thead>
                    <tr>
                      <th className="network-expand-column"><span className="visually-hidden">Expand</span></th>
                      <th>OLT</th>
                      <th>Management</th>
                      <th>Status</th>
                      <th>PON</th>
                      <th>ONUs</th>
                      <th>NAP</th>
                      <th className="network-actions-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOlts.map((olt) => {
                      const oltPons = ponsForOlt(olt);
                      const expandedBySearch = String(search || '').trim() && !matches(olt, search) && oltPons.length > 0;
                      const expanded = Boolean(expandedOltIds[olt.id]) || Boolean(expandedBySearch);
                      return (
                        <React.Fragment key={olt.id}>
                          <tr className={selectedOltId === olt.id ? 'table-active' : ''}>
                            <td className="network-expand-column">
                              <button
                                type="button"
                                className="network-expand-button"
                                title={`${expanded ? 'Collapse' : 'Expand'} ${olt.name} PON ports`}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${olt.name} PON ports`}
                                aria-expanded={expanded}
                                onClick={() => toggleOltExpansion(olt.id)}
                              >
                                {expanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                              </button>
                            </td>
                            <td><button type="button" className="network-row-select" onClick={() => toggleOltExpansion(olt.id)}>{olt.name}<span>{olt.site}</span></button></td>
                            <td>{olt.managementIp || '-'}<span>{olt.vendor} {olt.model}</span></td>
                            <td><StatusBadge value={olt.status} /></td>
                            <td>{olt.ponCount}/{olt.defaultPonCount}</td>
                            <td>{olt.onuCount ?? 0}</td>
                            <td>{olt.napCount}</td>
                            <RowActions label={olt.name} onEdit={() => openEditOlt(olt)} onDelete={() => remove(`/network-settings/olts/${olt.id}`, olt.name)} />
                          </tr>
                          {expanded && (
                            <tr className="network-expanded-row">
                              <td colSpan="8">
                                <div className="network-pon-expansion">
                                  <div className="network-pon-expansion-header">
                                    <div>
                                      <div className="network-pon-expansion-title">PON Ports</div>
                                      <div className="text-muted small">{oltPons.length} shown for {olt.name}</div>
                                    </div>
                                    <button type="button" className="btn btn-primary btn-sm network-header-icon-button" title={`New PON for ${olt.name}`} aria-label={`New PON for ${olt.name}`} onClick={() => openNewPon(olt.id)}>
                                      <IconPlus size={16} />
                                    </button>
                                  </div>
                                  <div className="table-responsive network-child-table-wrap">
                                    <table className="table table-vcenter network-table network-child-table">
                                      <thead><tr><th>PON</th><th>Status</th><th>Power Module</th><th>Split/VLAN</th><th>Capacity</th><th>ONUs</th><th>NAP</th><th className="network-actions-column">Actions</th></tr></thead>
                                      <tbody>
                                        {oltPons.map((pon) => {
                                          const ponOnus = onusForPon(pon.id);
                                          const onlineCount = ponOnus.filter((onu) => onu.status === 'ONLINE').length;
                                          return (
                                            <tr key={pon.id}>
                                              <td><span className="network-table-value fw-semibold">{pon.label}</span><div className="text-muted small">Port {pon.portNumber} / {pon.technology}</div></td>
                                              <td><StatusBadge value={pon.adminStatus} /> <StatusBadge value={pon.operationalStatus} /></td>
                                              <PonModuleCell pon={pon} />
                                              <td>{pon.splitRatio}<span>{pon.serviceVlan || 'No VLAN'}</span></td>
                                              <td>{pon.capacity}</td>
                                              <td>{pon.onuCount ?? ponOnus.length}<span>{onlineCount} online</span></td>
                                              <td>{pon.napCount}</td>
                                              <RowActions
                                                label={pon.label}
                                                onEdit={() => openEditPon(pon)}
                                                onDelete={() => remove(`/network-settings/pons/${pon.id}`, pon.label)}
                                                extraActions={[{
                                                  label: 'power',
                                                  title: `Add PON power for ${pon.label}`,
                                                  icon: IconAntenna,
                                                  className: 'bg-cyan-lt text-cyan',
                                                  onClick: () => openPonPower(pon)
                                                }]}
                                              />
                                            </tr>
                                          );
                                        })}
                                        {!oltPons.length && <tr><td colSpan="8"><div className="empty">No PON records for this OLT.</div></td></tr>}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {!filteredOlts.length && <tr><td colSpan="8"><div className="empty">No OLT or PON records match the current search.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderMapPage() {
    const oltMarkerImage = mapImageFor('olt');
    const napMarkerImage = mapImageFor('nap');
    return (
      <div className="network-map-page">
        <div
          ref={mapSurfaceRef}
          className={`network-map-surface ${mapDragging ? 'dragging' : ''}`}
          onMouseDown={startMapPan}
          onMouseMove={moveMapPan}
          onMouseUp={endMapPan}
          onMouseLeave={endMapPan}
          onWheel={(event) => {
            event.preventDefault();
            zoomMapAt(event.deltaY < 0 ? MAP_WHEEL_ZOOM_FACTOR : 1 / MAP_WHEEL_ZOOM_FACTOR, event.clientX, event.clientY);
          }}
        >
          <div className="network-map-toolbar" onMouseDown={(event) => event.stopPropagation()}>
            <div className="network-map-title">
              <span className="badge bg-indigo-lt text-indigo"><IconMap size={18} /></span>
              <div>
                <strong>Map</strong>
                <span>
                  {networkMap.totals.olts} OLTs / {networkMap.totals.naps} NAP boxes / {networkMap.totals.gps} GPS / {networkMap.mapMode}
                  {' / '}tiles z{networkMap.tileZoom}{mapHighDetail ? ' HD' : ''}{networkMap.nativeTileMaxed ? ' max' : ''}
                </span>
              </div>
            </div>
            <div className="network-map-controls">
              <SearchInput value={search} onChange={setSearch} placeholder="Search OLT, NAP, PON, barangay" />
              <select className="form-select form-select-sm" value={mapOltFilter} onChange={(event) => setMapOltFilter(event.target.value)}>
                <option value="">All OLTs</option>
                {olts.map((olt) => <option key={olt.id} value={olt.id}>{olt.name}</option>)}
              </select>
              <select className="form-select form-select-sm" value={mapTypeFilter} onChange={(event) => setMapTypeFilter(event.target.value)}>
                <option value="">All markers</option>
                <option value="olt">OLT only</option>
                <option value="nap">NAP only</option>
              </select>
              <button
                type="button"
                className={`btn btn-sm network-map-hd-toggle ${mapHighDetail ? 'btn-primary' : 'btn-outline-secondary'}`}
                title="Toggle higher detail map tiles"
                onClick={() => setMapHighDetail((current) => !current)}
              >
                HD
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomMapAt(1 / MAP_BUTTON_ZOOM_FACTOR)}>
                <IconZoomOut size={16} />
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm network-map-zoom-value"
                title={`Reset map view. Native tiles z${networkMap.tileZoom}${networkMap.nativeTileMaxed ? ' max' : ''}.`}
                onClick={resetMapView}
              >
                z{networkMap.viewZoom.toFixed(1)}
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomMapAt(MAP_BUTTON_ZOOM_FACTOR)}>
                <IconZoomIn size={16} />
              </button>
            </div>
          </div>
          <div className="network-map-tile-layer" aria-hidden="true">
            {networkMap.tiles.map((tile) => (
              <img
                key={tile.id}
                src={tile.src}
                alt=""
                draggable="false"
                style={{ left: tile.x, top: tile.y, width: tile.size, height: tile.size }}
              />
            ))}
          </div>
          <svg className="network-map-links" viewBox={`0 0 ${networkMap.surface.width} ${networkMap.surface.height}`} aria-hidden="true">
            {networkMap.lines.map((line) => (
              <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            ))}
          </svg>
          <div className="network-map-marker-layer">
            {networkMap.nodes.map((node) => {
              const markerImage = node.type === 'olt' ? oltMarkerImage : napMarkerImage;
              const MarkerIcon = node.type === 'olt' ? IconWifi : IconBox;
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`network-map-marker ${node.type} ${statusTone(node.status)}`}
                  style={{ left: node.x, top: node.y }}
                  title={`${node.label} - ${node.detail}`}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <span className="network-map-marker-art">
                    {markerImage ? <img src={markerImage} alt="" /> : <MarkerIcon size={24} />}
                  </span>
                  {mapLayerVisibility.details && (
                    <span className="network-map-marker-label">
                      <strong>{node.label}</strong>
                      <small>{node.detail}</small>
                      <em>{node.type === 'olt' ? `${node.napCount} NAP` : `${node.splitterRatio} / ${node.fbtCount || 0} FBT`}</em>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!networkMap.nodes.length && (
            <div className="network-map-empty">
              {mapLayerVisibility.olts || mapLayerVisibility.naps ? 'No OLT or NAP markers match the current filters.' : 'All marker layers are hidden.'}
            </div>
          )}
          <div
            className="network-map-legend"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="network-map-legend-header">
              <strong>Legend</strong>
              <button
                type="button"
                className="network-map-legend-reset"
                onClick={() => setMapLayerVisibility({ olts: true, naps: true, links: true, details: true })}
              >
                Show all
              </button>
            </div>
            <label className="network-map-legend-check">
              <input type="checkbox" checked={mapLayerVisibility.olts} onChange={() => toggleMapLayer('olts')} />
              <span><i className="network-map-dot olt" /> OLT markers</span>
            </label>
            <label className="network-map-legend-check">
              <input type="checkbox" checked={mapLayerVisibility.naps} onChange={() => toggleMapLayer('naps')} />
              <span><i className="network-map-dot nap" /> NAP boxes</span>
            </label>
            <label className="network-map-legend-check">
              <input type="checkbox" checked={mapLayerVisibility.links} onChange={() => toggleMapLayer('links')} />
              <span><i className="network-map-line-sample" /> PON assignment</span>
            </label>
            <label className="network-map-legend-check">
              <input type="checkbox" checked={mapLayerVisibility.details} onChange={() => toggleMapLayer('details')} />
              <span><i className="network-map-detail-sample" /> Details</span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  function renderNapPage() {
    return (
      <>
        <PageHeader title="NAP Boxes" />
        <div className="row row-cards network-settings-page">
          <div className="col-12">
            <Card
              title={`NAP Boxes (${filteredNaps.length})`}
              icon={IconBox}
              className="network-table-card"
              actions={tableActions({ placeholder: 'Search NAP, OLT, PON, barangay', onNew: openNewNap, newLabel: 'New NAP' })}
            >
              <div className="network-filter-bar">
                <label>
                  <span>OLT</span>
                  <select className="form-select form-select-sm" value={napOltFilter} onChange={(event) => setNapOltFilter(event.target.value)}>
                    <option value="">All OLTs</option>
                    {olts.map((olt) => <option key={olt.id} value={olt.id}>{olt.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>PON</span>
                  <select className="form-select form-select-sm" value={napPonFilter} onChange={(event) => setNapPonFilter(event.target.value)}>
                    <option value="">All PONs</option>
                    {napFilterPonOptions.map((pon) => <option key={pon.id} value={pon.id}>{ponPathLabel(pon, olts)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select className="form-select form-select-sm" value={napStatusFilter} onChange={(event) => setNapStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {meta.napStatuses.map((status) => <option key={status} value={status}>{titleize(status)}</option>)}
                  </select>
                </label>
                {(napOltFilter || napPonFilter || napStatusFilter || search) && (
                  <button type="button" className="btn btn-sm" onClick={() => {
                    setSearch('');
                    setNapOltFilter('');
                    setNapPonFilter('');
                    setNapStatusFilter('');
                  }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-nap-group-table">
                  <thead><tr><th className="network-expand-column"><span className="visually-hidden">Expand</span></th><th>OLT</th><th>Vendor / Site</th><th>Status</th><th>PONs</th><th>NAP Boxes</th><th>Active</th></tr></thead>
                  <tbody>
                    {napGroupsByOlt.map(({ olt, naps: oltNaps, ponGroups, activeCount, ponCount }) => {
                      const filtered = String(search || '').trim() || napOltFilter || napPonFilter || napStatusFilter;
                      const expanded = Boolean(expandedNapOltIds[olt.id]) || Boolean(filtered && oltNaps.length);
                      return (
                        <React.Fragment key={olt.id}>
                          <tr>
                            <td className="network-expand-column">
                              <button
                                type="button"
                                className="network-expand-button"
                                title={`${expanded ? 'Collapse' : 'Expand'} ${olt.name} NAP boxes`}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${olt.name} NAP boxes`}
                                aria-expanded={expanded}
                                onClick={() => toggleNapOltExpansion(olt.id)}
                              >
                                {expanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                              </button>
                            </td>
                            <td><button type="button" className="network-row-select" onClick={() => toggleNapOltExpansion(olt.id)}>{olt.name}<span>{olt.managementIp || 'No management IP'}</span></button></td>
                            <td>{olt.vendor || '-'}<span>{olt.site || '-'}</span></td>
                            <td><StatusBadge value={olt.status} /></td>
                            <td>{ponCount}</td>
                            <td>{oltNaps.length}</td>
                            <td>{activeCount}</td>
                          </tr>
                          {expanded && (
                            <tr className="network-expanded-row">
                              <td colSpan="7">
                                <div className="network-pon-expansion network-nap-expansion">
                                  <div className="network-pon-expansion-header">
                                    <div>
                                      <div className="network-pon-expansion-title">NAP Boxes Under {olt.name}</div>
                                      <div className="text-muted small">{oltNaps.length} shown across {ponCount} PON module{ponCount === 1 ? '' : 's'}</div>
                                    </div>
                                  </div>
                                  <div className="table-responsive network-child-table-wrap">
                                    <table className="table table-vcenter network-table network-child-table network-nap-pon-table">
                                      <thead><tr><th className="network-expand-column"><span className="visually-hidden">Expand</span></th><th>PON</th><th>Technology / Status</th><th>NAP Boxes</th><th>Active</th><th>FBT</th><th>Capacity</th></tr></thead>
                                      <tbody>
                                        {ponGroups.map(({ pon, naps: ponNaps, activeCount: ponActiveCount, fbtCount }) => {
                                          const ponExpanded = Boolean(expandedNapPonIds[pon.id]) || Boolean(filtered && ponNaps.length);
                                          return (
                                            <React.Fragment key={pon.id}>
                                              <tr>
                                                <td className="network-expand-column">
                                                  <button
                                                    type="button"
                                                    className="network-expand-button"
                                                    title={`${ponExpanded ? 'Collapse' : 'Expand'} ${canonicalPonLabel(pon)} NAP boxes`}
                                                    aria-label={`${ponExpanded ? 'Collapse' : 'Expand'} ${canonicalPonLabel(pon)} NAP boxes`}
                                                    aria-expanded={ponExpanded}
                                                    onClick={() => toggleNapPonExpansion(pon.id)}
                                                  >
                                                    {ponExpanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                                                  </button>
                                                </td>
                                                <td>
                                                  <button type="button" className="network-row-select" onClick={() => toggleNapPonExpansion(pon.id)}>
                                                    {canonicalPonLabel(pon)}
                                                    <span>{ponPathLabel(pon, olts)}</span>
                                                  </button>
                                                </td>
                                                <td>
                                                  {pon.technology || '-'}
                                                  <span>{titleize(pon.adminStatus)} / {titleize(pon.operationalStatus)}</span>
                                                </td>
                                                <td>{ponNaps.length}</td>
                                                <td>{ponActiveCount}</td>
                                                <td>{fbtCount}</td>
                                                <td>{pon.allocatedOnus || 0}/{pon.capacity || 0}</td>
                                              </tr>
                                              {ponExpanded && (
                                                <tr className="network-nap-pon-expanded-row">
                                                  <td colSpan="7">
                                                    <div className="network-nap-leaf-wrap">
                                                      <table className="table table-vcenter network-table network-child-table network-nap-child-table network-nap-leaf-table">
                                                        <thead><tr><th>NAP</th><th>Status</th><th>Splitter</th><th>FBT</th><th>Barangay</th><th>Coordinates</th><th className="network-actions-column">Actions</th></tr></thead>
                                                        <tbody>
                                                          {ponNaps.map((nap) => (
                                                            <tr key={nap.id}>
                                                              <td><span className="network-table-value fw-semibold">{nap.name}</span><div className="text-muted small">{nap.notes || 'No notes'}</div></td>
                                                              <td><StatusBadge value={nap.status} /></td>
                                                              <td>{formatSplitterRatio(nap.splitterRatio)}</td>
                                                              <td>{nap.fbtCount}/{nap.portCapacity}</td>
                                                              <td>{nap.barangay || '-'}</td>
                                                              <td>{hasCoordinates(nap) ? `${nap.latitude}, ${nap.longitude}` : '-'}</td>
                                                              <RowActions label={nap.name} onEdit={() => openEditNap(nap)} onDelete={() => remove(`/network-settings/nap-boxes/${nap.id}`, nap.name)} />
                                                            </tr>
                                                          ))}
                                                          {!ponNaps.length && <tr><td colSpan="7"><div className="empty">No NAP records match this PON and filter set.</div></td></tr>}
                                                        </tbody>
                                                      </table>
                                                    </div>
                                                  </td>
                                                </tr>
                                              )}
                                            </React.Fragment>
                                          );
                                        })}
                                        {!ponGroups.length && <tr><td colSpan="7"><div className="empty">No PON groups match this OLT and filter set.</div></td></tr>}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {!napGroupsByOlt.length && <tr><td colSpan="7"><div className="empty">No NAP records match the current filters.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderOnusPage() {
    const refreshSeconds = Number(meta.onuTableRefreshSeconds || ONU_AUTO_REFRESH_SECONDS);
    const ponOptions = pons.filter((pon) => !onuOltFilter || pon.oltId === onuOltFilter);
    const onuCountsByPon = pons
      .map((pon) => {
        const ponOnus = onus.filter((onu) => onu.ponPortId === pon.id);
        return {
          ...pon,
          onuCount: ponOnus.length,
          onlineCount: ponOnus.filter((onu) => onu.status === 'ONLINE').length,
          issueCount: ponOnus.filter((onu) => ['OFFLINE', 'LOS', 'DYING_GASP'].includes(onu.status)).length
        };
      })
      .filter((pon) => pon.onuCount > 0)
      .sort((a, b) => b.onuCount - a.onuCount || a.oltName.localeCompare(b.oltName) || a.portNumber - b.portNumber);
    const kpis = [
      ['Total ONUs', onus.length, IconRouter, 'blue'],
      ['Online', onus.filter((onu) => onu.status === 'ONLINE').length, IconCircleCheck, 'green'],
      ['Offline / Issues', onus.filter((onu) => ['OFFLINE', 'LOS', 'DYING_GASP'].includes(onu.status)).length, IconAlertTriangle, 'red'],
      ['PONs With ONUs', onuCountsByPon.length, IconNetwork, 'azure']
    ];
    return (
      <>
        <PageHeader title="ONUs" subtitle={`Auto-refreshes every ${formatSeconds(refreshSeconds)} while this page is open.`} />
        <div className="row row-cards network-settings-page">
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
            <Card title="ONUs Per PON" icon={IconNetwork} className="network-table-card">
              <div className="network-pon-kpi-grid">
                {onuCountsByPon.map((pon) => (
                  <button
                    type="button"
                    key={pon.id}
                    className={`network-pon-kpi ${onuPonFilter === pon.id ? 'active' : ''}`}
                    onClick={() => {
                      setOnuOltFilter(pon.oltId);
                      setOnuPonFilter(onuPonFilter === pon.id ? '' : pon.id);
                    }}
                  >
                    <span>{pon.oltName}</span>
                    <strong>{pon.ponLabel || pon.label}</strong>
                    <em>{pon.onuCount} ONU{pon.onuCount === 1 ? '' : 's'} / {pon.onlineCount} online</em>
                  </button>
                ))}
                {!onuCountsByPon.length && <div className="empty network-capture-empty">No captured ONU counts per PON yet.</div>}
              </div>
            </Card>
          </div>
          <div className="col-12">
            <Card
              title={`Captured ONUs (${filteredOnus.length})`}
              icon={IconRouter}
              className="network-table-card"
              actions={tableActions({ placeholder: 'Search ONU, serial, OLT, PON, status' })}
            >
              <div className="network-filter-bar">
                <label>
                  <span>Status</span>
                  <select className="form-select form-select-sm" value={onuStatusFilter} onChange={(event) => setOnuStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {meta.onuStatuses.map((status) => <option key={status} value={status}>{titleize(status)}</option>)}
                  </select>
                </label>
                <label>
                  <span>OLT</span>
                  <select className="form-select form-select-sm" value={onuOltFilter} onChange={(event) => setOnuOltFilter(event.target.value)}>
                    <option value="">All OLTs</option>
                    {olts.map((olt) => <option key={olt.id} value={olt.id}>{olt.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>PON</span>
                  <select className="form-select form-select-sm" value={onuPonFilter} onChange={(event) => setOnuPonFilter(event.target.value)}>
                    <option value="">All PONs</option>
                    {ponOptions.map((pon) => <option key={pon.id} value={pon.id}>{pon.oltName} / {pon.label}</option>)}
                  </select>
                </label>
                {(onuStatusFilter || onuOltFilter || onuPonFilter) && (
                  <button type="button" className="btn btn-sm" onClick={() => {
                    setOnuStatusFilter('');
                    setOnuOltFilter('');
                    setOnuPonFilter('');
                  }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-onu-table">
                  <thead><tr><th>ONU</th><th>PON</th><th>Status</th><th>Power Meter</th><th>Identity</th><th>Service</th><th>Last Capture</th></tr></thead>
                  <tbody>
                    {filteredOnus.map((onu) => (
                      <tr key={onu.id}>
                        <td>
                          <span className="network-table-value fw-semibold">{onu.name}</span>
                          <div className="text-muted small">ONU ID {onu.onuId || '-'} / ifIndex {onu.sourceIfIndex || '-'}</div>
                        </td>
                        <td>{onu.ponLabel}<span>{onu.oltName} / Port {onu.ponPortNumber}</span></td>
                        <td><StatusBadge value={onu.status} /><span>{titleize(onu.adminStatus)} / {titleize(onu.operationalStatus)}</span></td>
                        <td>
                          Rx {onu.rxPowerDbm || '-'} dBm / Tx {onu.txPowerDbm || '-'} dBm
                          <span>{onu.temperatureC ? `${onu.temperatureC}C` : 'Temp -'} / {onu.voltageV ? `${onu.voltageV}V` : 'Volt -'} / {onu.biasCurrentMa ? `${onu.biasCurrentMa}mA` : 'Bias -'}</span>
                        </td>
                        <td>
                          {onu.serialNumber || '-'}
                          <span>MAC {onu.macAddress || '-'} / {onu.vendor || onu.sourceDeviceVendor || '-'}</span>
                        </td>
                        <td>
                          VLAN {onu.vlan || '-'} / SP {onu.servicePort || '-'}
                          <span>{onu.profile || 'Profile -'} / {onu.distanceMeters ? `${onu.distanceMeters}m` : 'Distance -'}</span>
                        </td>
                        <td>{formatDateTime(onu.lastCapturedAt)}<span>ifIndex {onu.sourceIfIndex || '-'}</span></td>
                      </tr>
                    ))}
                    {!filteredOnus.length && <tr><td colSpan="7"><div className="empty">No captured ONUs yet. Run Capture on an SNMP OLT after the OLT exposes ONU/ONT interfaces through SNMP.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderPppoeAccountsPage() {
    const routerOptions = pppoeRouters.length
      ? pppoeRouters
      : devices.filter((device) => device.accessMethod === 'API' && device.deviceType === 'MIKROTIK');
    const profileOptions = pppoeProfiles.length
      ? pppoeProfiles
      : [...new Set(pppoeAccounts.map((account) => account.profile).filter(Boolean))].sort();
    const kpis = [
      ['Total Accounts', pppoeKpis.total ?? pppoeAccounts.length, IconRouter, 'blue'],
      ['Online', pppoeKpis.online ?? 0, IconCircleCheck, 'green'],
      ['Offline', pppoeKpis.offline ?? 0, IconAlertTriangle, 'yellow'],
      ['Disabled', pppoeKpis.disabled ?? 0, IconX, 'red'],
      ['Routers', pppoeKpis.routers ?? routerOptions.length, IconNetwork, 'azure'],
      ['Profiles', pppoeKpis.profiles ?? profileOptions.length, IconServer2, 'indigo'],
      ['Caller IDs', pppoeKpis.withCallerId ?? 0, IconApi, 'cyan'],
      ['Assigned IPs', pppoeKpis.withAssignedAddress ?? 0, IconRadar, 'teal']
    ];
    const startRow = sortedPppoeAccounts.length ? (pppoeCurrentPage - 1) * pppoePageSize + 1 : 0;
    const endRow = Math.min(pppoeCurrentPage * pppoePageSize, sortedPppoeAccounts.length);
    const SortHeader = ({ label, field }) => (
      <button type="button" className="network-sort-button" onClick={() => togglePppoeSort(field)}>
        {label}<span>{pppoeSortLabel(field)}</span>
      </button>
    );
    return (
      <>
        <PageHeader title="PPPoE Accounts" subtitle={`Live MikroTik API view${pppoeCapturedAt ? ` captured ${formatDateTime(pppoeCapturedAt)}` : ''}.`} />
        <div className="row row-cards network-settings-page">
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
              title={`PPPoE Accounts (${filteredPppoeAccounts.length})`}
              icon={IconRouter}
              className="network-table-card"
              actions={(
                <div className="btn-list network-header-actions">
                  <SearchInput value={search} onChange={setSearch} placeholder="Search username, MAC, IP, profile, router" />
                  <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Refresh PPPoE accounts" aria-label="Refresh PPPoE accounts" disabled={pppoeLoading} onClick={loadPppoeAccounts}>
                    <IconRefresh size={16} />
                  </button>
                </div>
              )}
            >
              {pppoeDeviceErrors.map((deviceError) => (
                <div className="alert alert-warning mb-2" key={deviceError.deviceId}>
                  {deviceError.deviceName}: {deviceError.message}
                </div>
              ))}
              <div className="network-filter-bar">
                <label>
                  <span>Router</span>
                  <select className="form-select form-select-sm" value={pppoeRouterFilter} onChange={(event) => setPppoeRouterFilter(event.target.value)}>
                    <option value="">All MikroTik routers</option>
                    {routerOptions.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select className="form-select form-select-sm" value={pppoeStatusFilter} onChange={(event) => setPppoeStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {(meta.pppoeAccountStatuses || defaultMeta.pppoeAccountStatuses).map((status) => <option key={status} value={status}>{titleize(status)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Profile</span>
                  <select className="form-select form-select-sm" value={pppoeProfileFilter} onChange={(event) => setPppoeProfileFilter(event.target.value)}>
                    <option value="">All profiles</option>
                    {profileOptions.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
                  </select>
                </label>
                <label>
                  <span>Show Entries</span>
                  <select className="form-select form-select-sm" value={pppoePageSize} onChange={(event) => setPppoePageSize(Number(event.target.value))}>
                    {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                {(pppoeStatusFilter || pppoeRouterFilter || pppoeProfileFilter || search) && (
                  <button type="button" className="btn btn-sm" onClick={() => {
                    setSearch('');
                    setPppoeStatusFilter('');
                    setPppoeRouterFilter('');
                    setPppoeProfileFilter('');
                  }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="network-table-meta">
                <span>Showing {startRow}-{endRow} of {sortedPppoeAccounts.length}</span>
                {pppoeLoading && <span>Refreshing from MikroTik API...</span>}
              </div>
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-pppoe-table">
                  <thead>
                    <tr>
                      <th><SortHeader label="Account" field="username" /></th>
                      <th><SortHeader label="Router" field="routerName" /></th>
                      <th><SortHeader label="Status" field="status" /></th>
                      <th><SortHeader label="Caller ID" field="callerId" /></th>
                      <th><SortHeader label="IP Address" field="activeAddress" /></th>
                      <th><SortHeader label="Profile" field="profile" /></th>
                      <th><SortHeader label="Session" field="uptime" /></th>
                      <th><SortHeader label="Last Seen" field="lastLoggedOut" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPppoeAccounts.map((account) => (
                      <tr key={account.id}>
                        <td><span className="network-table-value fw-semibold">{account.username}</span><div className="text-muted small">{titleize(account.service || 'pppoe')} / {account.source}</div></td>
                        <td>{account.routerName}<span>{account.routerEndpoint}</span></td>
                        <td><StatusBadge value={account.status} /><span>{account.radius ? 'RADIUS session' : account.disabled ? 'Disabled secret' : 'Local secret'}</span></td>
                        <td>{account.callerId || '-'}<span>Last {account.lastCallerId || '-'}</span></td>
                        <td>{account.activeAddress || account.remoteAddress || '-'}<span>Local {account.localAddress || '-'}</span></td>
                        <td>{account.profile || '-'}<span>{account.comment || 'No comment'}</span></td>
                        <td>{account.uptime || '-'}<span>{account.activeInterface || account.encoding || account.sessionId || '-'}</span></td>
                        <td>{account.lastLoggedOut || '-'}<span>{account.lastDisconnectReason || '-'}</span></td>
                      </tr>
                    ))}
                    {!pagedPppoeAccounts.length && (
                      <tr>
                        <td colSpan="8">
                          <div className="empty">{pppoeLoading ? 'Reading PPPoE accounts from MikroTik...' : 'No PPPoE accounts match the current filters.'}</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="network-pagination">
                <button type="button" className="btn btn-sm" disabled={pppoeCurrentPage <= 1} onClick={() => setPppoePage(1)}>First</button>
                <button type="button" className="btn btn-sm" disabled={pppoeCurrentPage <= 1} onClick={() => setPppoePage((current) => Math.max(1, current - 1))}>Prev</button>
                <span>Page {pppoeCurrentPage} of {pppoeTotalPages}</span>
                <button type="button" className="btn btn-sm" disabled={pppoeCurrentPage >= pppoeTotalPages} onClick={() => setPppoePage((current) => Math.min(pppoeTotalPages, current + 1))}>Next</button>
                <button type="button" className="btn btn-sm" disabled={pppoeCurrentPage >= pppoeTotalPages} onClick={() => setPppoePage(pppoeTotalPages)}>Last</button>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderFbtPage() {
    return (
      <>
        <PageHeader title="FBT" />
        <div className="row row-cards network-settings-page">
          <div className="col-12">
            <Card
              title={`FBT Records (${filteredFbts.length})`}
              icon={IconNetwork}
              className="network-table-card"
              actions={tableActions({ placeholder: 'Search FBT, NAP, OLT', onNew: openNewFbt, newLabel: 'New FBT' })}
            >
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table">
                  <thead><tr><th>FBT</th><th>NAP</th><th>Path</th><th>Status</th><th>Ports</th><th className="network-actions-column">Actions</th></tr></thead>
                  <tbody>
                    {filteredFbts.map((fbt) => (
                      <tr key={fbt.id}>
                        <td><span className="network-table-value fw-semibold">{fbt.name}</span><div className="text-muted small">{fbt.locationHint || '-'}</div></td>
                        <td>{fbt.napName}</td>
                        <td>{fbt.oltName}<span>{fbt.ponLabel}</span></td>
                        <td><StatusBadge value={fbt.status} /></td>
                        <td>{fbt.portNumber} / {fbt.portCapacity}</td>
                        <RowActions label={fbt.name} onEdit={() => openEditFbt(fbt)} onDelete={() => remove(`/network-settings/fbts/${fbt.id}`, fbt.name)} />
                      </tr>
                    ))}
                    {!filteredFbts.length && <tr><td colSpan="6"><div className="empty">No FBT records match the current search.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderCaptureModal() {
    if (!captureDevice) return null;
    const result = captureResult || captureDevice.lastCapture;
    const system = result?.system || {};
    const reconciliation = result?.reconciliation || {};
    const ponCandidates = result?.ponCandidates || [];
    const onuCandidates = result?.onuCandidates || [];
    const interfaces = result?.interfaces || [];
    const successful = result?.status === 'SUCCESS';
    return (
      <div className="network-modal-backdrop" role="presentation">
        <div className="network-modal network-capture-modal" role="dialog" aria-modal="true" aria-labelledby="network-capture-title">
          <div className="network-modal-header">
            <h3 id="network-capture-title" className="network-modal-title">
              <IconRadar size={18} className="me-2 text-muted" />
              Capture {captureDevice.name}
            </h3>
            <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={closeCaptureModal}><IconX size={18} /></button>
          </div>
          <div className="network-modal-body">
            <div className="network-capture-summary">
              <div>
                <span className="text-muted small">Endpoint</span>
                <strong>{captureDevice.connectionLabel}</strong>
              </div>
              <div>
                <span className="text-muted small">SNMP</span>
                <strong>{titleize(captureDevice.snmpVersion)} / {titleize(captureDevice.snmpTransport)}</strong>
              </div>
              <div>
                <span className="text-muted small">Last Capture</span>
                <strong>{result ? formatDateTime(result.capturedAt) : 'Never'}</strong>
              </div>
            </div>
            {captureRunning && (
              <div className="network-capture-progress" role="status" aria-live="polite">
                <div className="network-capture-progress-header">
                  <span className="network-capture-progress-label">Capturing OLT data</span>
                  <span className="network-capture-progress-detail">Reading SNMP system, interface, PON, and ONU data...</span>
                </div>
                <div className="network-capture-progress-track" role="progressbar" aria-label="Capture in progress" aria-valuetext="Capture in progress">
                  <div className="network-capture-progress-bar" />
                </div>
              </div>
            )}
            {captureError && <div className="alert alert-danger mb-3">{captureError}</div>}
            {!result && <div className="empty network-capture-empty">No capture has been run for this device yet.</div>}
            {result && (
              <>
                <div className={`alert ${successful ? 'alert-success' : 'alert-warning'} network-capture-state`}>
                  <span>{successful ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}</span>
                  <span>{result.message || titleize(result.status)}</span>
                </div>
                <div className="network-capture-section">
                  <div className="network-capture-section-title">Captured System</div>
                  <div className="network-capture-grid">
                    <div><span>System Name</span><strong>{system.sysName || '-'}</strong></div>
                    <div><span>Vendor</span><strong>{system.vendor || captureDevice.vendor || '-'}</strong></div>
                    <div><span>Model</span><strong>{system.model || captureDevice.model || '-'}</strong></div>
                    <div><span>Object ID</span><strong>{system.sysObjectID || '-'}</strong></div>
                    <div><span>Location</span><strong>{system.sysLocation || '-'}</strong></div>
                    <div><span>SNMP Uptime</span><strong>{formatSysUpTime(system.sysUpTime)}</strong></div>
                    <div><span>Interfaces</span><strong>{result.interfaceCount ?? interfaces.length}</strong></div>
                  </div>
                  {system.sysDescr && <div className="network-capture-descr">{system.sysDescr}</div>}
                </div>
                <div className="network-capture-section">
                  <div className="network-capture-section-title">Inventory Saved</div>
                  <div className="network-capture-grid">
                    <div><span>OLT</span><strong>{reconciliation.oltName || '-'}</strong></div>
                    <div><span>OLT Action</span><strong>{reconciliation.oltCreated ? 'Created' : reconciliation.oltUpdated ? 'Updated' : titleize(reconciliation.scope || 'Device only')}</strong></div>
                    <div><span>PON Candidates</span><strong>{result.ponCandidateCount ?? ponCandidates.length}</strong></div>
                    <div><span>ONU Candidates</span><strong>{result.onuCandidateCount ?? onuCandidates.length}</strong></div>
                    <div><span>PON Created</span><strong>{reconciliation.createdPons ?? 0}</strong></div>
                    <div><span>PON Updated</span><strong>{reconciliation.updatedPons ?? 0}</strong></div>
                    <div><span>ONU Created</span><strong>{reconciliation.createdOnus ?? 0}</strong></div>
                    <div><span>ONU Updated</span><strong>{reconciliation.updatedOnus ?? 0}</strong></div>
                  </div>
                </div>
                <div className="network-capture-section">
                  <div className="network-capture-section-title">PON Candidates</div>
                  <div className="table-responsive network-capture-table-wrap">
                    <table className="table table-vcenter network-table network-capture-table">
                      <thead><tr><th>Port</th><th>Interface</th><th>Technology</th><th>Status</th></tr></thead>
                      <tbody>
                        {ponCandidates.map((pon) => (
                          <tr key={`${pon.ifIndex}-${pon.portNumber}`}>
                            <td>{pon.portNumber}<span>ifIndex {pon.ifIndex}</span></td>
                            <td>{pon.label}<span>{pon.ifDescr || pon.ifAlias || '-'}</span></td>
                            <td>{titleize(pon.technology)}</td>
                            <td><StatusBadge value={pon.adminStatus} /> <StatusBadge value={pon.operationalStatus} /></td>
                          </tr>
                        ))}
                        {!ponCandidates.length && <tr><td colSpan="4"><div className="empty">No PON-like interfaces were detected from IF-MIB.</div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="network-capture-section">
                  <div className="network-capture-section-title">ONU Candidates</div>
                  <div className="table-responsive network-capture-table-wrap">
                    <table className="table table-vcenter network-table network-capture-table">
                      <thead><tr><th>ONU</th><th>PON</th><th>Status</th><th>Power</th><th>Interface</th></tr></thead>
                      <tbody>
                        {onuCandidates.map((onu) => (
                          <tr key={`${onu.ifIndex}-${onu.onuId}`}>
                            <td>{onu.name}<span>{onu.serialNumber || `ONU ID ${onu.onuId || '-'}`} / MAC {onu.macAddress || '-'}</span></td>
                            <td>{onu.ponPortNumber || '-'}<span>Captured assignment</span></td>
                            <td><StatusBadge value={onu.status} /> <StatusBadge value={onu.operationalStatus} /></td>
                            <td>Rx {onu.rxPowerDbm || '-'} / Tx {onu.txPowerDbm || '-'}<span>{onu.distanceMeters ? `${onu.distanceMeters}m` : 'Distance -'}</span></td>
                            <td>{onu.ifName || '-'}<span>{onu.ifDescr || onu.ifAlias || `ifIndex ${onu.ifIndex || '-'}`}</span></td>
                          </tr>
                        ))}
                        {!onuCandidates.length && <tr><td colSpan="5"><div className="empty">No ONU/ONT interfaces were detected from generic IF-MIB.</div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="network-modal-footer">
            <button type="button" className="btn" onClick={closeCaptureModal}>Close</button>
            <button type="button" className="btn btn-primary" disabled={captureRunning} onClick={runCapture}>
              <IconPlayerPlay size={18} className="me-2" />
              {captureRunning ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderModal() {
    if (modalType === 'location-bindings' && locationBindingDevice) {
      const selectedCount = locationBindingSelection.length;
      const isOltLocationBinding = isSnmpOltDevice(locationBindingDevice);
      if (isOltLocationBinding) {
        return (
          <CrudModal
            title={`Bind OLT Location: ${locationBindingDevice.name}`}
            icon={IconMapPin}
            onClose={closeModal}
            onSubmit={saveLocationBindings}
            submitDisabled={locationBindingSaving}
            submitLabel={locationBindingSaving ? 'Saving...' : 'Save Location'}
          >
            {locationBindingError && <div className="col-12"><div className="alert alert-danger mb-0">{locationBindingError}</div></div>}
            <div className="col-12">
              <div className="network-location-binding-summary">
                <span className="badge bg-purple-lt text-purple"><IconMapPin size={16} /></span>
                <span>Set the OLT coordinates used by the Network Settings map</span>
              </div>
            </div>
            <SelectInput label="Saved Location" value={oltLocationForm.locationId} onChange={selectOltLocation}>
              <option value="">Manual coordinates</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}{hasCoordinates(location) ? ` (${location.latitude}, ${location.longitude})` : ''}
                </option>
              ))}
            </SelectInput>
            <TextInput label="Map Label / Site" value={oltLocationForm.label} onChange={(value) => setOltLocationForm({ ...oltLocationForm, label: value })} />
            <div className="col-12">
              <div className="network-coordinate-capture">
                <div className="network-coordinate-capture-header">
                  <div>
                    <label className="form-label mb-0">Coordinates</label>
                    <small>Click Capture, then click the map to fill the OLT latitude and longitude.</small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    aria-expanded={oltLocationPickerOpen}
                    onClick={openOltLocationCapture}
                  >
                    <IconMap size={16} className="me-2" />
                    Capture
                  </button>
                </div>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Latitude</label>
                    <input
                      className="form-control"
                      required
                      placeholder="Example: 14.599512"
                      value={oltLocationForm.latitude ?? ''}
                      onChange={(event) => setOltLocationForm({ ...oltLocationForm, latitude: event.target.value })}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Longitude</label>
                    <input
                      className="form-control"
                      required
                      placeholder="Example: 120.984222"
                      value={oltLocationForm.longitude ?? ''}
                      onChange={(event) => setOltLocationForm({ ...oltLocationForm, longitude: event.target.value })}
                    />
                  </div>
                </div>
                {oltLocationPickerOpen && (
                  <div className="network-coordinate-picker-wrap">
                    <div className="network-coordinate-picker-actions" onMouseDown={(event) => event.stopPropagation()}>
                      <span>{oltLocationPickerMap.zoom}z</span>
                      <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => updateOltLocationPickerZoom(-1)}>
                        <IconZoomOut size={16} />
                      </button>
                      <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => updateOltLocationPickerZoom(1)}>
                        <IconZoomIn size={16} />
                      </button>
                    </div>
                    <div
                      ref={oltLocationPickerSurfaceRef}
                      className={`network-coordinate-picker ${oltLocationPickerDragging ? 'dragging' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label="Click map to capture OLT coordinates"
                      onMouseDown={startOltLocationPickerPan}
                      onMouseMove={moveOltLocationPickerPan}
                      onMouseUp={finishOltLocationPickerPan}
                      onMouseLeave={cancelOltLocationPickerPan}
                      onWheel={(event) => {
                        event.preventDefault();
                        updateOltLocationPickerZoom(event.deltaY < 0 ? 1 : -1);
                      }}
                    >
                      <div className="network-coordinate-tile-layer" aria-hidden="true">
                        {oltLocationPickerMap.tiles.map((tile) => (
                          <img
                            key={tile.id}
                            src={tile.src}
                            alt=""
                            draggable="false"
                            style={{ left: tile.x, top: tile.y }}
                          />
                        ))}
                      </div>
                      {oltLocationPickerMap.marker && (
                        <span
                          className="network-coordinate-picker-marker"
                          style={{ left: oltLocationPickerMap.marker.x, top: oltLocationPickerMap.marker.y }}
                          aria-hidden="true"
                        >
                          <IconMapPin size={30} />
                        </span>
                      )}
                    </div>
                    <div className="network-coordinate-picker-hint">
                      Click to capture. Drag to pan, or use the zoom buttons to adjust the map.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CrudModal>
        );
      }
      return (
        <CrudModal
          title={`Bind Locations: ${locationBindingDevice.name}`}
          icon={IconMapPin}
          onClose={closeModal}
          onSubmit={saveLocationBindings}
          submitDisabled={locationBindingSaving}
          submitLabel={locationBindingSaving ? 'Saving...' : 'Save Bindings'}
        >
          {locationBindingError && <div className="col-12"><div className="alert alert-danger mb-0">{locationBindingError}</div></div>}
          <div className="col-12">
            <div className="network-location-binding-summary">
              <span className="badge bg-purple-lt text-purple">{selectedCount}</span>
              <span>selected for PPPoE provisioning router selection</span>
            </div>
          </div>
          <div className="col-12">
            <div className="network-location-binding-list">
              {locations.map((location) => {
                const checked = locationBindingSelection.includes(location.id);
                return (
                  <label className={`network-location-binding-option ${checked ? 'active' : ''}`} key={location.id}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleLocationBinding(location.id, event.target.checked)}
                    />
                    <span>
                      <strong>{locationLabel(location)}</strong>
                      <small>{location.address || [location.barangay, location.municipality, location.province].filter(Boolean).join(', ') || 'No address recorded'}</small>
                    </span>
                  </label>
                );
              })}
              {!locations.length && <div className="empty mb-0">No System Settings locations are available to bind.</div>}
            </div>
          </div>
        </CrudModal>
      );
    }
    if (modalType === 'device') {
      const isSnmp = deviceForm.accessMethod === 'SNMP';
      const isSnmpV3 = isSnmp && deviceForm.snmpVersion === 'V3';
      const showDeviceFields = Boolean(deviceForm.accessMethod && deviceForm.deviceType);
      const needsSnmpAuthPassword = ['AUTH_NO_PRIV', 'AUTH_PRIV'].includes(deviceForm.snmpAuthLevel);
      const needsSnmpPrivacyPassword = deviceForm.snmpAuthLevel === 'AUTH_PRIV';
      return (
        <CrudModal title={deviceForm.id ? 'Edit Device' : 'New Device'} icon={IconNetwork} onClose={closeModal} onSubmit={saveDevice} submitDisabled={deviceSaving} submitLabel={deviceSaving ? 'Testing...' : 'Save'}>
          {deviceFormError && <div className="col-12"><div className="alert alert-danger mb-0">{deviceFormError}</div></div>}
          <AccessChoice value={deviceForm.accessMethod} options={deviceScope.deviceType ? [deviceScope.accessMethod] : meta.deviceAccessMethods} onChange={(value) => {
            setDeviceTab(value);
            setDeviceForm({
              ...deviceForm,
              accessMethod: value,
              apiPort: value === 'API' ? deviceForm.apiPort || '8728' : deviceForm.apiPort,
              snmpPort: deviceForm.snmpPort || '161'
            });
          }} />
          {deviceForm.accessMethod && (
            <DeviceTypeChoice value={deviceForm.deviceType} options={deviceScope.deviceType ? [deviceScope.deviceType] : meta.deviceTypes} onChange={(value) => setDeviceForm({ ...deviceForm, deviceType: value })} />
          )}
          {showDeviceFields && (
            <>
              <TextInput label="Display Name" value={deviceForm.name} onChange={(value) => setDeviceForm({ ...deviceForm, name: value })} />
              <TextInput label="Hostname / IP" value={deviceForm.managementIp} required onChange={(value) => setDeviceForm({ ...deviceForm, managementIp: value })} />
              {deviceForm.accessMethod === 'API' && (
                <>
                  <SelectInput label="API Protocol" value={deviceForm.apiProtocol} options={meta.apiProtocols} onChange={(value) => setDeviceForm({ ...deviceForm, apiProtocol: value })} />
                  <TextInput label="API Port" type="number" min="1" max="65535" value={deviceForm.apiPort} onChange={(value) => setDeviceForm({ ...deviceForm, apiPort: value })} />
                  {deviceForm.deviceType === 'MIKROTIK' && (
                    <>
                      <TextInput label="API Username" value={deviceForm.apiUsername} required onChange={(value) => setDeviceForm({ ...deviceForm, apiUsername: value })} />
                      <TextInput
                        label="API Password"
                        type="password"
                        value={deviceForm.apiPassword}
                        required={!deviceForm.id || !deviceForm.hasApiPassword}
                        placeholder={deviceForm.id && deviceForm.hasApiPassword ? 'Leave blank to keep existing password' : ''}
                        onChange={(value) => setDeviceForm({ ...deviceForm, apiPassword: value })}
                      />
                    </>
                  )}
                </>
              )}
              {isSnmp && (
                <>
                  <SelectInput label="SNMP Version" value={deviceForm.snmpVersion} options={meta.snmpVersions} onChange={(value) => setDeviceForm({ ...deviceForm, snmpVersion: value })} />
                  {!isSnmpV3 && (
                    <TextInput
                      label="Community"
                      type="password"
                      value={deviceForm.snmpCommunity}
                      placeholder="Blank tries all snmp.community communities"
                      onChange={(value) => setDeviceForm({ ...deviceForm, snmpCommunity: value })}
                    />
                  )}
                  {isSnmpV3 && (
                    <>
                      <SelectInput label="Auth Level" value={deviceForm.snmpAuthLevel} options={meta.snmpAuthLevels} onChange={(value) => setDeviceForm({ ...deviceForm, snmpAuthLevel: value })} />
                      <TextInput label="Auth User Name" value={deviceForm.snmpAuthName} required onChange={(value) => setDeviceForm({ ...deviceForm, snmpAuthName: value })} />
                      <TextInput label="Auth Password" type="password" value={deviceForm.snmpAuthPassword} required={!deviceForm.id && needsSnmpAuthPassword} onChange={(value) => setDeviceForm({ ...deviceForm, snmpAuthPassword: value })} />
                      <SelectInput label="Auth Algorithm" value={deviceForm.snmpAuthProtocol} options={meta.snmpAuthProtocols} onChange={(value) => setDeviceForm({ ...deviceForm, snmpAuthProtocol: value })} />
                      <TextInput label="Crypto Password" type="password" value={deviceForm.snmpPrivacyPassword} required={!deviceForm.id && needsSnmpPrivacyPassword} onChange={(value) => setDeviceForm({ ...deviceForm, snmpPrivacyPassword: value })} />
                      <SelectInput label="Crypto Algorithm" value={deviceForm.snmpPrivacyProtocol} options={meta.snmpPrivacyProtocols} onChange={(value) => setDeviceForm({ ...deviceForm, snmpPrivacyProtocol: value })} />
                    </>
                  )}
                  <TextInput label="SNMP Port" type="number" min="1" max="65535" value={deviceForm.snmpPort} onChange={(value) => setDeviceForm({ ...deviceForm, snmpPort: value })} />
                  <SelectInput label="Transport" value={deviceForm.snmpTransport} options={meta.snmpTransports} onChange={(value) => setDeviceForm({ ...deviceForm, snmpTransport: value })} />
                  <SelectInput label="Port Association" value={deviceForm.portAssociationMode} options={meta.portAssociationModes} onChange={(value) => setDeviceForm({ ...deviceForm, portAssociationMode: value })} />
                  <TextInput label="Poller Group" value={deviceForm.pollerGroup} onChange={(value) => setDeviceForm({ ...deviceForm, pollerGroup: value })} />
                  <CheckboxInput label="Force Add" checked={deviceForm.forceAdd} help="Skip checks" onChange={(value) => setDeviceForm({ ...deviceForm, forceAdd: value })} />
                </>
              )}
            </>
          )}
        </CrudModal>
      );
    }
    if (modalType === 'olt') {
      return (
        <CrudModal title={oltForm.id ? 'Edit OLT' : 'New OLT'} icon={IconWifi} onClose={closeModal} onSubmit={saveOlt}>
          <TextInput label="OLT Name" value={oltForm.name} required onChange={(value) => setOltForm({ ...oltForm, name: value })} />
          <TextInput label="Site" value={oltForm.site} onChange={(value) => setOltForm({ ...oltForm, site: value })} />
          <TextInput label="Management IP" value={oltForm.managementIp} onChange={(value) => setOltForm({ ...oltForm, managementIp: value })} />
          <TextInput label="Vendor" value={oltForm.vendor} onChange={(value) => setOltForm({ ...oltForm, vendor: value })} />
          <TextInput label="Model" value={oltForm.model} onChange={(value) => setOltForm({ ...oltForm, model: value })} />
          <TextInput label="Firmware" value={oltForm.firmwareVersion} onChange={(value) => setOltForm({ ...oltForm, firmwareVersion: value })} />
          <SelectInput label="Status" value={oltForm.status} options={meta.oltStatuses} onChange={(value) => setOltForm({ ...oltForm, status: value })} />
          <TextInput label="Default PON Count" type="number" min="1" max="128" value={oltForm.defaultPonCount} onChange={(value) => setOltForm({ ...oltForm, defaultPonCount: value })} />
          <NotesInput label="Notes" value={oltForm.notes} onChange={(value) => setOltForm({ ...oltForm, notes: value })} />
        </CrudModal>
      );
    }
    if (modalType === 'pon') {
      return (
        <CrudModal title={ponForm.id ? 'Edit PON' : 'New PON'} icon={IconNetwork} onClose={closeModal} onSubmit={savePon}>
          <TextInput label="Port No." type="number" min="1" value={ponForm.portNumber} onChange={(value) => setPonForm({ ...ponForm, portNumber: value })} />
          <TextInput label="Label" value={ponForm.label} onChange={(value) => setPonForm({ ...ponForm, label: value })} />
          <SelectInput
            label="Technology"
            value={ponForm.technology}
            options={meta.ponTechnologies}
            onChange={(value) => setPonForm({ ...ponForm, technology: value, ...ponDefaultsForTechnology(value) })}
          />
          <SelectInput label="Admin" value={ponForm.adminStatus} options={meta.adminStatuses} onChange={(value) => setPonForm({ ...ponForm, adminStatus: value })} />
          <SelectInput label="Operational" value={ponForm.operationalStatus} options={meta.operationalStatuses} onChange={(value) => setPonForm({ ...ponForm, operationalStatus: value })} />
          <TextInput label="Split Ratio" value={ponForm.splitRatio} onChange={(value) => setPonForm({ ...ponForm, splitRatio: value })} />
          <TextInput label="VLAN" value={ponForm.serviceVlan} onChange={(value) => setPonForm({ ...ponForm, serviceVlan: value })} />
          <TextInput label="Capacity" type="number" min="1" value={ponForm.capacity} onChange={(value) => setPonForm({ ...ponForm, capacity: value })} />
          <NotesInput label="Notes" value={ponForm.notes} onChange={(value) => setPonForm({ ...ponForm, notes: value })} />
        </CrudModal>
      );
    }
    if (modalType === 'pon-power') {
      return (
        <CrudModal title={`Power Module: ${ponForm.label || 'PON'}`} icon={IconAntenna} onClose={closeModal} onSubmit={savePonPower}>
          <TextInput label="Module Vendor" value={ponForm.moduleVendor} onChange={(value) => setPonForm({ ...ponForm, moduleVendor: value })} />
          <TextInput label="Part Number" value={ponForm.modulePartNumber} onChange={(value) => setPonForm({ ...ponForm, modulePartNumber: value })} />
          <TextInput label="Serial Number" value={ponForm.moduleSerial} onChange={(value) => setPonForm({ ...ponForm, moduleSerial: value })} />
          <TextInput label="Rx Power (dBm)" placeholder="-7.50" value={ponForm.moduleRxPowerDbm} onChange={(value) => setPonForm({ ...ponForm, moduleRxPowerDbm: value })} />
          <TextInput label="Tx Power (dBm)" placeholder="-5.30" value={ponForm.moduleTxPowerDbm} onChange={(value) => setPonForm({ ...ponForm, moduleTxPowerDbm: value })} />
          <TextInput label="Temperature (C)" placeholder="49.2" value={ponForm.moduleTemperatureC} onChange={(value) => setPonForm({ ...ponForm, moduleTemperatureC: value })} />
          <TextInput label="Voltage (V)" placeholder="3.27" value={ponForm.moduleVoltageV} onChange={(value) => setPonForm({ ...ponForm, moduleVoltageV: value })} />
          <TextInput label="Bias Current (mA)" placeholder="24.8" value={ponForm.moduleBiasCurrentMa} onChange={(value) => setPonForm({ ...ponForm, moduleBiasCurrentMa: value })} />
          <TextInput label="Hardware Rev" value={ponForm.moduleHardwareRev} onChange={(value) => setPonForm({ ...ponForm, moduleHardwareRev: value })} />
        </CrudModal>
      );
    }
    if (modalType === 'nap') {
      return (
        <CrudModal title={napForm.id ? 'Edit NAP Box' : 'New NAP Box'} icon={IconBox} onClose={closeModal} onSubmit={saveNap} submitDisabled={napSaving} submitLabel={napSaving ? 'Saving...' : 'Save'}>
          {napFormMessage && <div className="col-12"><div className="alert alert-success mb-0">{napFormMessage}</div></div>}
          {napFormError && <div className="col-12"><div className="alert alert-danger mb-0">{napFormError}</div></div>}
          <SelectInput label="OLT" value={napSelectedOltId} required onChange={selectNapOlt}>
            <option value="">Select OLT</option>
            {olts.map((olt) => (
              <option key={olt.id} value={olt.id}>{[olt.vendor, olt.name].filter(Boolean).join(' / ') || olt.name}</option>
            ))}
          </SelectInput>
          <NapPonChoices pons={napPonOptions} value={napForm.ponPortId} onChange={selectNapPon} />
          <TextInput label="NAP Name" value={napForm.name} required onChange={(value) => setNapForm({ ...napForm, name: value })} />
          <TextInput label="Latitude" value={napForm.latitude} onChange={(value) => setNapForm({ ...napForm, latitude: value })} />
          <TextInput label="Longitude" value={napForm.longitude} onChange={(value) => setNapForm({ ...napForm, longitude: value })} />
          <TextInput label="Barangay" value={napForm.barangay} list="network-nap-barangay-options" placeholder="Search or select barangay" onChange={(value) => setNapForm({ ...napForm, barangay: value })} />
          <datalist id="network-nap-barangay-options">
            {barangayOptions.map((barangay) => <option key={barangay} value={barangay} />)}
          </datalist>
          <RadioChoiceInput
            label="Splitter Ratio"
            value={normalizeNapSplitterRatio(napForm.splitterRatio)}
            options={meta.napSplitterRatios || defaultMeta.napSplitterRatios}
            formatLabel={formatSplitterRatio}
            onChange={(value) => setNapForm({ ...napForm, splitterRatio: value })}
          />
          <SelectInput label="Status" value={napForm.status} options={meta.napStatuses} onChange={(value) => setNapForm({ ...napForm, status: value })} />
          <NotesInput label="Notes" value={napForm.notes} onChange={(value) => setNapForm({ ...napForm, notes: value })} />
          {!napForm.id && (
            <CheckboxInput
              label="After Save"
              checked={napAddAnother}
              onChange={setNapAddAnother}
              help="Add another NAP using the same OLT and PON"
            />
          )}
        </CrudModal>
      );
    }
    if (modalType === 'fbt') {
      return (
        <CrudModal title={fbtForm.id ? 'Edit FBT' : 'New FBT'} icon={IconNetwork} onClose={closeModal} onSubmit={saveFbt}>
          <TextInput label="FBT Name" value={fbtForm.name} required onChange={(value) => setFbtForm({ ...fbtForm, name: value })} />
          <SelectInput label="Assigned NAP" value={fbtForm.napBoxId} required onChange={(value) => setFbtForm({ ...fbtForm, napBoxId: value })}><NapOptions naps={naps} /></SelectInput>
          <TextInput label="Port No." type="number" min="1" value={fbtForm.portNumber} onChange={(value) => setFbtForm({ ...fbtForm, portNumber: value })} />
          <TextInput label="Port Capacity" type="number" min="1" value={fbtForm.portCapacity} onChange={(value) => setFbtForm({ ...fbtForm, portCapacity: value })} />
          <SelectInput label="Status" value={fbtForm.status} options={meta.fbtStatuses} onChange={(value) => setFbtForm({ ...fbtForm, status: value })} />
          <TextInput label="Location Hint" value={fbtForm.locationHint} onChange={(value) => setFbtForm({ ...fbtForm, locationHint: value })} />
          <NotesInput label="Notes" value={fbtForm.notes} onChange={(value) => setFbtForm({ ...fbtForm, notes: value })} />
        </CrudModal>
      );
    }
    return null;
  }

  return (
    <>
      {message && (
        <div className="alert alert-success network-success-alert mb-3" role="status" aria-live="polite">
          <span className="network-success-alert-icon" aria-hidden="true"><IconDeviceFloppy size={18} /></span>
          <span>{message}</span>
        </div>
      )}
      {error && <div className="alert alert-danger mb-3">{error}</div>}
      {activeSection === 'overview' && renderOverview()}
      {activeSection === 'mikrotik-settings' && renderDevicesPage()}
      {activeSection === 'pppoe' && renderPppoeAccountsPage()}
      {activeSection === 'olt-settings' && renderDevicesPage()}
      {activeSection === 'map' && renderMapPage()}
      {activeSection === 'olts' && renderOltPonPage()}
      {activeSection === 'onus' && renderOnusPage()}
      {activeSection === 'naps' && renderNapPage()}
      {activeSection === 'fbts' && renderFbtPage()}
      {renderModal()}
      {renderCaptureModal()}
    </>
  );
}
