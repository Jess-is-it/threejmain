import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertTriangle,
  IconAntenna,
  IconApi,
  IconArrowsMaximize,
  IconBox,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconDeviceFloppy,
  IconEdit,
  IconHome,
  IconHomeOff,
  IconHomeSignal,
  IconMap,
  IconMapPin,
  IconNetwork,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconRadar,
  IconRefresh,
  IconRouter,
  IconSearch,
  IconServer2,
  IconSettings,
  IconTrash,
  IconWifi,
  IconX,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react';
import {
  createMapProviderSession,
  defaultMapProvider,
  enabledMapProviders,
  mapProviderById,
  mapProviderNeedsSession,
  mapProviderTileUrl,
  mapProviderTypeLabel,
  mapProviderWithSession,
  normalizeMapProviderSettings
} from '../../system-settings/web/mapProviders';
import './networkSettings.css';

const API = '/api';
const ADD_SPLITTER_MANUFACTURER_VALUE = '__add_new_splitter_manufacturer__';
const PON_COLOR_BASES = ['#20C997', '#FCC419', '#339AF0', '#CC5DE8'];
const MAP_PREFERENCES_STORAGE_KEY = 'threejmain.networkSettings.mappingPreferences';
const MAP_LAYER_VISIBILITY_DEFAULTS = {
  olts: true,
  naps: true,
  links: false,
  details: true
};
const MAP_PROVIDER_FALLBACKS = {
  street: 'esri-streets',
  satellite: 'esri-satellite'
};

const defaultFiberColorEntries = [
  { position: 1, name: 'Blue', hex: '#2563EB' },
  { position: 2, name: 'Orange', hex: '#F97316' },
  { position: 3, name: 'Green', hex: '#16A34A' },
  { position: 4, name: 'Brown', hex: '#92400E' },
  { position: 5, name: 'Slate', hex: '#64748B' },
  { position: 6, name: 'White', hex: '#F8FAFC' },
  { position: 7, name: 'Red', hex: '#DC2626' },
  { position: 8, name: 'Black', hex: '#111827' },
  { position: 9, name: 'Yellow', hex: '#EAB308' },
  { position: 10, name: 'Violet', hex: '#7C3AED' },
  { position: 11, name: 'Rose', hex: '#F472B6' },
  { position: 12, name: 'Aqua', hex: '#06B6D4' }
];

const defaultFiberColorSettings = {
  standardName: 'TIA-598',
  fiberColors: defaultFiberColorEntries,
  tubeColors: defaultFiberColorEntries,
  notes: 'Default 12-color sequence for individual fibers and loose tubes.'
};

const defaultMeta = {
  oltStatuses: ['PLANNED', 'ACTIVE', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  ponTechnologies: ['GPON', 'EPON', 'XGS_PON', 'OTHER'],
  ponColorPalette: PON_COLOR_BASES,
  adminStatuses: ['ENABLED', 'DISABLED', 'RESERVED'],
  operationalStatuses: ['UNKNOWN', 'UP', 'DEGRADED', 'DOWN'],
  napStatuses: ['PLANNED', 'ACTIVE', 'FULL', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  napSplitterRatios: ['1:8', '1:16'],
  fbtStatuses: ['PLANNED', 'ACTIVE', 'FULL', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  splitterStatuses: ['PLANNED', 'ACTIVE', 'FULL', 'MAINTENANCE', 'OFFLINE', 'ARCHIVED'],
  splitterTypes: ['PLC', 'LCP', 'FBT'],
  plcSplitterRatios: ['1:4', '1:8', '1:16'],
  lcpSplitterRatios: ['1:4', '1:8', '1:16'],
  splitterRatios: ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128', '50:50', '60:40', '70:30', '80:20', '90:10'],
  fbtSplitRatios: ['1:99', '5:95', '10:90', '15:85', '20:80', '25:75', '30:70', '35:65', '40:60', '50:50'],
  wavelengthsNm: ['1310', '1490', '1550'],
  fiberOpticStatuses: ['ACTIVE', 'PLANNED', 'ARCHIVED'],
  fiberCoreCountOptions: [1, 2, 4, 6, 8, 12, 24, 48, 60, 72],
  fiberColorSettings: defaultFiberColorSettings,
  splitterPackageTypes: ['LCP_MODULE', 'CASSETTE', 'ABS_BOX', 'STEEL_TUBE', 'RACK_TRAY', 'NAP_TRAY', 'CLOSURE'],
  splitterConnectorTypes: ['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC', 'BARE_FIBER', 'SPLICE'],
  splitterStages: ['PRIMARY', 'SECONDARY', 'DROP', 'TAP'],
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
  AUTH_PRIV: 'authPriv',
  PLC: 'PLC',
  LCP: 'LCP',
  FBT: 'FBT',
  LCP_MODULE: 'LCP Module',
  ABS_BOX: 'ABS Box',
  STEEL_TUBE: 'Steel Tube',
  RACK_TRAY: 'Rack Tray',
  NAP_TRAY: 'NAP Tray',
  BARE_FIBER: 'Bare Fiber',
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  DROP: 'Drop',
  TAP: 'Tap'
};

function formatSplitterRatio(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.startsWith('1:') ? text.replace(':', 'x') : text.replace(':', '/');
}

function formatFbtRatio(value) {
  const text = String(value || '').trim();
  return text ? text.replace(':', '/') : '-';
}

function splitterOutputPortsFromRatio(value, fallback = 0) {
  const normalized = String(value || '').trim().replace(/[xX/]/g, ':');
  if (!normalized.includes(':')) return fallback;
  const [input, output] = normalized.split(':', 2).map((part) => part.trim());
  if (input !== '1') return fallback;
  const outputPorts = Number(output);
  return Number.isFinite(outputPorts) && outputPorts > 0 ? outputPorts : fallback;
}

const fbtLossFields = [
  'connectorLoss1310Db',
  'connectorLoss1490Db',
  'connectorLoss1550Db',
  'currentNapLoss1310Db',
  'currentNapLoss1490Db',
  'currentNapLoss1550Db',
  'nextNapLoss1310Db',
  'nextNapLoss1490Db',
  'nextNapLoss1550Db'
];

function normalizeFbtRatioValue(value) {
  return String(value || '').trim().replace(/[xX/]/g, ':').replace(/\s+/g, '');
}

function makeFbtRatioRow(ratio, source = {}, isCustom = false) {
  const normalizedRatio = normalizeFbtRatioValue(source.ratio || source.splitRatio || ratio);
  const row = {
    id: source.id || `${isCustom ? 'custom' : 'ratio'}-${normalizedRatio.replace(':', '-') || Date.now()}`,
    ratio: normalizedRatio,
    isCustom: Boolean(source.isCustom) || isCustom
  };
  fbtLossFields.forEach((field) => {
    row[field] = source[field] || '';
  });
  return row;
}

function defaultFbtRatioRows(ratios = defaultMeta.fbtSplitRatios) {
  return ratios.map((ratio) => makeFbtRatioRow(ratio));
}

function normalizeFbtRatioRows(rows, fallbackRatio = '5:95', ratios = defaultMeta.fbtSplitRatios, legacy = {}) {
  const byRatio = new Map();
  if (Array.isArray(rows)) {
    rows.forEach((row) => {
      const normalized = normalizeFbtRatioValue(row?.ratio || row?.splitRatio);
      if (normalized) byRatio.set(normalized, makeFbtRatioRow(normalized, row, row?.isCustom || !ratios.includes(normalized)));
    });
  }

  const legacyRatio = normalizeFbtRatioValue(fallbackRatio);
  if (legacyRatio && !byRatio.has(legacyRatio) && fbtLossFields.some((field) => legacy?.[field])) {
    byRatio.set(legacyRatio, makeFbtRatioRow(legacyRatio, legacy, !ratios.includes(legacyRatio)));
  }

  const defaults = ratios.map((ratio) => byRatio.get(ratio) || makeFbtRatioRow(ratio));
  const customRows = [...byRatio.values()].filter((row) => !ratios.includes(row.ratio));
  return [...defaults, ...customRows];
}

function compactFbtRatioRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      ratio: normalizeFbtRatioValue(row.ratio)
    }))
    .filter((row) => row.ratio);
}

function combinedFbtLossValue(row, prefix, wavelengths) {
  const values = wavelengths.map((wavelength) => row[`${prefix}${wavelength}Db`] || '');
  let lastFilled = values.length - 1;
  while (lastFilled >= 0 && !values[lastFilled]) {
    lastFilled -= 1;
  }
  return lastFilled >= 0 ? values.slice(0, lastFilled + 1).join(' / ') : '';
}

function splitCombinedLossValue(value) {
  return String(value || '').split(/[\/,]/).map((part) => part.trim());
}

function makeSplitterPortLossRows(splitRatio, sourceRows = [], legacyLoss = '') {
  const outputPorts = splitterOutputPortsFromRatio(splitRatio, 1);
  const byPort = new Map();
  if (Array.isArray(sourceRows)) {
    sourceRows.forEach((row) => {
      const portNumber = Number(row?.portNumber);
      if (Number.isFinite(portNumber) && portNumber > 0) {
        byPort.set(portNumber, row);
      }
    });
  }
  return Array.from({ length: outputPorts }, (_, index) => {
    const portNumber = index + 1;
    const existing = byPort.get(portNumber) || {};
    return {
      id: existing.id || `port-${portNumber}`,
      portNumber,
      insertionLossDb: existing.insertionLossDb || legacyLoss || ''
    };
  });
}

function compactSplitterPortLossRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      id: row.id || `port-${index + 1}`,
      portNumber: Number(row.portNumber || index + 1),
      insertionLossDb: String(row.insertionLossDb || '').trim()
    }))
    .filter((row) => row.portNumber > 0);
}

function normalizeSplitterRatioValue(value) {
  return String(value || '').trim().replace(/[xX/]/g, ':').replace(/\s+/g, '');
}

function normalizeVisibleWavelengths(wavelengths) {
  const selected = Array.isArray(wavelengths) ? wavelengths : defaultMeta.wavelengthsNm;
  const filtered = defaultMeta.wavelengthsNm.filter((wavelength) => selected.includes(wavelength));
  return filtered.length ? filtered : defaultMeta.wavelengthsNm;
}

function clearUncheckedFbtWavelengths(rows, visibleWavelengths) {
  const visible = new Set(normalizeVisibleWavelengths(visibleWavelengths));
  return rows.map((row) => {
    const next = { ...row };
    ['connectorLoss', 'currentNapLoss', 'nextNapLoss'].forEach((prefix) => {
      defaultMeta.wavelengthsNm.forEach((wavelength) => {
        if (!visible.has(wavelength)) {
          next[`${prefix}${wavelength}Db`] = '';
        }
      });
    });
    return next;
  });
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
const MAP_MAX_SCALE = 256;
const MAP_WHEEL_ZOOM_FACTOR = 1.28;
const MAP_BUTTON_ZOOM_FACTOR = 1.45;
const SERVICEABILITY_MAP_MAX_SCALE = 2048;
const SERVICEABILITY_MAP_WHEEL_ZOOM_FACTOR = 1.42;
const SERVICEABILITY_MAP_BUTTON_ZOOM_FACTOR = 1.75;
const MAP_MAX_NATIVE_TILE_ZOOM = 19;
const MAP_MAX_NATIVE_TILE_ZOOM_BY_MODE = {
  street: 19,
  satellite: 19
};
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

const splitterDefaults = {
  PLC: { splitRatio: '1:16', inputPorts: '1', outputPorts: '16', portCapacity: '16', connectorType: 'SC/APC', packageType: 'CASSETTE', stage: 'SECONDARY' },
  LCP: { splitRatio: '1:16', inputPorts: '1', outputPorts: '16', portCapacity: '16', connectorType: 'SC/APC', packageType: 'LCP_MODULE', stage: 'PRIMARY' },
  FBT: { splitRatio: '5:95', inputPorts: '1', outputPorts: '2', portCapacity: '2', connectorType: 'BARE_FIBER', packageType: 'STEEL_TUBE', stage: 'TAP' }
};

function normalizeSplitterType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return defaultMeta.splitterTypes.includes(normalized) ? normalized : 'FBT';
}

function splitterDefaultsForType(type) {
  return splitterDefaults[normalizeSplitterType(type)] || splitterDefaults.FBT;
}

function isPortLossSplitterType(type) {
  return ['PLC', 'LCP'].includes(normalizeSplitterType(type));
}

function ratioOptionsForSplitterType(type, meta) {
  const splitterType = normalizeSplitterType(type);
  if (splitterType === 'PLC') return meta.plcSplitterRatios || defaultMeta.plcSplitterRatios;
  if (splitterType === 'LCP') return meta.lcpSplitterRatios || defaultMeta.lcpSplitterRatios;
  return meta.splitterRatios || defaultMeta.splitterRatios;
}

function normalizeSplitterRatioProfiles(splitterType, profiles = [], fallbackRatio = '', fallbackPortLosses = [], legacyLoss = '', allowedRatios = ratioOptionsForSplitterType(splitterType, defaultMeta)) {
  const defaults = splitterDefaultsForType(splitterType);
  const allowed = allowedRatios.map(normalizeSplitterRatioValue).filter(Boolean);
  const byRatio = new Map();
  const addProfile = (ratio, source = {}) => {
    const normalizedRatio = normalizeSplitterRatioValue(source.splitRatio || source.ratio || ratio);
    if (!normalizedRatio || (allowed.length && !allowed.includes(normalizedRatio))) return;
    const outputPorts = splitterOutputPortsFromRatio(normalizedRatio, Number(source.outputPorts || source.portCapacity || 1));
    byRatio.set(normalizedRatio, {
      id: source.id || `ratio-${normalizedRatio.replace(':', '-')}`,
      splitRatio: normalizedRatio,
      ratio: normalizedRatio,
      outputPorts,
      portCapacity: outputPorts,
      portLosses: makeSplitterPortLossRows(normalizedRatio, source.portLosses, source.insertionLossDb ?? legacyLoss)
    });
  };

  if (Array.isArray(profiles)) {
    profiles.forEach((profile) => addProfile(profile?.splitRatio || profile?.ratio, profile));
  }

  const fallback = normalizeSplitterRatioValue(fallbackRatio || defaults.splitRatio);
  if (!byRatio.size || (fallbackPortLosses?.length && !byRatio.has(fallback))) {
    addProfile(fallback, {
      splitRatio: fallback,
      outputPorts: splitterOutputPortsFromRatio(fallback, Number(defaults.outputPorts || 1)),
      portLosses: fallbackPortLosses,
      insertionLossDb: legacyLoss
    });
  }

  const ordered = allowed.map((ratio) => byRatio.get(ratio)).filter(Boolean);
  const extras = [...byRatio.values()].filter((profile) => !allowed.includes(profile.splitRatio));
  return [...ordered, ...extras];
}

function compactSplitterRatioProfiles(splitterType, profiles, fallbackRatio, fallbackPortLosses, legacyLoss, allowedRatios) {
  return normalizeSplitterRatioProfiles(splitterType, profiles, fallbackRatio, fallbackPortLosses, legacyLoss, allowedRatios)
    .map((profile) => {
      const outputPorts = splitterOutputPortsFromRatio(profile.splitRatio, Number(profile.outputPorts || profile.portCapacity || 1));
      return {
        id: profile.id || `ratio-${profile.splitRatio.replace(':', '-')}`,
        splitRatio: profile.splitRatio,
        ratio: profile.splitRatio,
        outputPorts,
        portCapacity: outputPorts,
        portLosses: compactSplitterPortLossRows(makeSplitterPortLossRows(profile.splitRatio, profile.portLosses, profile.insertionLossDb))
      };
    })
    .filter((profile) => profile.splitRatio);
}

function normalizeHexColor(value, fallback = '#64748B') {
  const text = String(value || '').trim();
  if (!/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) return fallback;
  const hex = text.replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  return `#${expanded.toUpperCase()}`;
}

function adjustHexColor(hexColor, amount) {
  const normalized = normalizeHexColor(hexColor, PON_COLOR_BASES[0]).replace('#', '');
  const channels = [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  const adjusted = channels.map((channel) => Math.max(0, Math.min(255, channel + amount)));
  return `#${adjusted.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function defaultPonColor(portNumber = 1, palette = PON_COLOR_BASES) {
  const safePalette = Array.isArray(palette) && palette.length ? palette : PON_COLOR_BASES;
  const number = Math.max(1, Number.parseInt(portNumber, 10) || 1);
  const base = normalizeHexColor(safePalette[(number - 1) % safePalette.length], PON_COLOR_BASES[(number - 1) % PON_COLOR_BASES.length]);
  const familyIndex = Math.floor((number - 1) / safePalette.length);
  if (!familyIndex) return base;
  const amount = Math.ceil(familyIndex / 2) * 18 * (familyIndex % 2 ? -1 : 1);
  return adjustHexColor(base, amount);
}

function ponColor(pon, palette = PON_COLOR_BASES) {
  return normalizeHexColor(pon?.colorHex, defaultPonColor(pon?.portNumber, palette));
}

function normalizeFiberColorPalette(rows, defaults = defaultFiberColorEntries) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return defaults.map((fallback, index) => {
    const source = sourceRows[index] || {};
    return {
      position: index + 1,
      name: String(source.name || fallback.name).trim(),
      hex: normalizeHexColor(source.hex, fallback.hex)
    };
  });
}

function normalizeFiberColorSettings(settings) {
  const source = settings || {};
  return {
    standardName: String(source.standardName || defaultFiberColorSettings.standardName).trim(),
    fiberColors: normalizeFiberColorPalette(source.fiberColors, defaultFiberColorSettings.fiberColors),
    tubeColors: normalizeFiberColorPalette(source.tubeColors, defaultFiberColorSettings.tubeColors),
    notes: String(source.notes || defaultFiberColorSettings.notes).trim()
  };
}

function fiberColorByPosition(palette, position) {
  const colors = Array.isArray(palette) && palette.length ? palette : defaultFiberColorEntries;
  return colors[(Math.max(Number(position) || 1, 1) - 1) % colors.length];
}

function fiberColorFromSource(source, palette, fallbackPosition, prefix = '') {
  const fallback = fiberColorByPosition(palette, fallbackPosition);
  return {
    name: String(source?.[`${prefix}ColorName`] || source?.colorName || source?.name || fallback.name).trim(),
    hex: normalizeHexColor(source?.[`${prefix}ColorHex`] || source?.colorHex || source?.hex, fallback.hex)
  };
}

function fiberCoreCountFromGroups(groups) {
  return (Array.isArray(groups) ? groups : []).reduce((total, group) => {
    const cores = Array.isArray(group?.cores) ? group.cores : [];
    return total + cores.length;
  }, 0);
}

function normalizeFiberCoreCount(value, fallback = 12) {
  const count = Number(value);
  const resolved = Number.isFinite(count) && count > 0 ? Math.round(count) : fallback;
  const isListed = defaultMeta.fiberCoreCountOptions.includes(resolved);
  const isTwelveGroup = resolved >= 12 && resolved % 12 === 0;
  return isListed || isTwelveGroup ? Math.min(resolved, 288) : fallback;
}

function fiberCoreCountUsesTubes(value) {
  return normalizeFiberCoreCount(value, 12) > 12;
}

function buildFiberColorGroups(coreCount, settings = defaultFiberColorSettings, currentGroups = []) {
  const normalizedSettings = normalizeFiberColorSettings(settings);
  const count = normalizeFiberCoreCount(coreCount, fiberCoreCountFromGroups(currentGroups) || 12);
  const usesTubes = fiberCoreCountUsesTubes(count);
  const sourceGroups = Array.isArray(currentGroups) ? currentGroups : [];
  const groups = [];
  let remaining = count;
  let fiberNumber = 1;
  let groupIndex = 0;
  while (remaining > 0) {
    const groupNumber = groupIndex + 1;
    const groupSize = Math.min(12, remaining);
    const sourceGroup = sourceGroups[groupIndex] || {};
    const tube = usesTubes ? fiberColorFromSource(sourceGroup, normalizedSettings.tubeColors, groupNumber, 'tube') : { name: '', hex: '' };
    const sourceCores = Array.isArray(sourceGroup.cores) ? sourceGroup.cores : [];
    const cores = Array.from({ length: groupSize }, (_, index) => {
      const corePosition = index + 1;
      const sourceCore = sourceCores[index] || {};
      const fiberColor = fiberColorFromSource(sourceCore, normalizedSettings.fiberColors, corePosition);
      return {
        fiberNumber: fiberNumber + index,
        position: corePosition,
        colorName: fiberColor.name,
        colorHex: fiberColor.hex
      };
    });
    groups.push({
      id: sourceGroup.id || `group-${groupNumber}`,
      groupNumber,
      groupName: usesTubes ? (sourceGroup.groupName || `Tube ${groupNumber}`) : 'Core Colors',
      tubeColorName: tube.name,
      tubeColorHex: tube.hex,
      cores
    });
    fiberNumber += groupSize;
    remaining -= groupSize;
    groupIndex += 1;
  }
  return groups;
}

function makeBlankFiberOptic(settings = defaultFiberColorSettings) {
  return {
    id: '',
    manufacturer: '',
    model: '',
    coreCount: '12',
    colorGroups: buildFiberColorGroups(12, settings),
    loss1310DbPer1000m: '',
    loss1490DbPer1000m: '',
    loss1550DbPer1000m: '',
    status: 'ACTIVE',
    notes: ''
  };
}

function fiberOpticLossField(wavelength) {
  return `loss${wavelength}DbPer1000m`;
}

function hasFiberOpticLossValue(profile) {
  return defaultMeta.wavelengthsNm.some((wavelength) => String(profile[fiberOpticLossField(wavelength)] ?? '').trim());
}

function buildFiberOpticDisplayName(profile, coreCountValue) {
  const coreCount = normalizeFiberCoreCount(coreCountValue ?? profile.coreCount, fiberCoreCountFromGroups(profile.colorGroups) || 12);
  const label = [
    profile.manufacturer,
    profile.model,
    coreCount ? `${coreCount} Core` : ''
  ].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
  return label || 'Fiber Optic';
}

function fiberMappingCollapsedContainerAnchorWidth(node, hasSummary) {
  const labelWidth = String(node?.label || '').length * 8;
  const detailWidth = String(node?.detail || '').length * 6.3;
  const titleWidth = Math.min(164, Math.max(labelWidth, detailWidth));
  const chromeWidth = 68;
  const minimumWidth = hasSummary ? 172 : 164;
  return clamp(Math.round(chromeWidth + titleWidth), minimumWidth, node.width);
}

function fiberMappingAssignmentPosition(assignment, index = 0) {
  return {
    x: Number.isFinite(Number(assignment?.positionX)) ? Number(assignment.positionX) : 124 + index * 150,
    y: Number.isFinite(Number(assignment?.positionY)) ? Number(assignment.positionY) : FIBER_INTERNAL_CANVAS.height / 2
  };
}

function fiberMappingExpandedContainerSize(node) {
  const assignments = Array.isArray(node?.splitterAssignments) ? node.splitterAssignments : [];
  const positions = assignments.map((assignment, index) => fiberMappingAssignmentPosition(assignment, index));
  const connectionPointPrefix = `${node?.key || ''}|`;
  const storedPointPositions = Object.entries(node?.connectionPoints || {})
    .filter(([pointKey, point]) => pointKey.startsWith(connectionPointPrefix)
      && Number.isFinite(Number(point?.positionX))
      && Number.isFinite(Number(point?.positionY)))
    .map(([, point]) => ({ x: Number(point.positionX), y: Number(point.positionY) }));
  const allPositions = [...positions, ...storedPointPositions];
  const maxX = allPositions.reduce((largest, position) => Math.max(largest, position.x), 0);
  const maxY = allPositions.reduce((largest, position) => Math.max(largest, position.y), 0);
  const internalWidth = Math.max(FIBER_INTERNAL_CANVAS.minWidth, maxX + FIBER_INTERNAL_CANVAS.branchLength + 72);
  const internalHeight = Math.max(FIBER_INTERNAL_CANVAS.height, maxY + 52);
  return {
    width: Math.max(node?.width || FIBER_MAPPING_NODE_SIZE.nap.width, internalWidth + FIBER_MAPPING_EXPANDED_CONTAINER_CHROME.width),
    height: Math.max(node?.height || FIBER_MAPPING_NODE_SIZE.nap.height, internalHeight + FIBER_MAPPING_EXPANDED_CONTAINER_CHROME.height)
  };
}

function fiberMappingNodeVisualSize(node, expandedContainerKeys = []) {
  const isContainer = ['nap', 'junction'].includes(node?.type);
  if (isContainer && expandedContainerKeys.includes(node.key)) {
    return fiberMappingExpandedContainerSize(node);
  }
  if (!isContainer) {
    return { width: node.width, height: node.height };
  }
  return fiberMappingNodeAnchorSize(node, expandedContainerKeys);
}

function fiberMappingNodeRect(node, size) {
  return {
    left: node.x,
    top: node.y,
    right: node.x + size.width,
    bottom: node.y + size.height
  };
}

function fiberMappingRangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function fiberMappingRectsOverlap(rectA, rectB) {
  return fiberMappingRangesOverlap(rectA.left, rectA.right, rectB.left, rectB.right)
    && fiberMappingRangesOverlap(rectA.top, rectA.bottom, rectB.top, rectB.bottom);
}

function fiberMappingNodeBaseDepth(node) {
  if (node?.type === 'olt') return 0;
  if (node?.type === 'pon') return 1;
  if (['nap', 'junction'].includes(node?.type)) return 2;
  return 3;
}

function fiberMappingNodeConnectionDepth(node, nodeMap, memo = new Map(), seen = new Set()) {
  if (!node?.key) return fiberMappingNodeBaseDepth(node);
  if (memo.has(node.key)) return memo.get(node.key);
  if (seen.has(node.key)) return fiberMappingNodeBaseDepth(node);
  seen.add(node.key);
  let depth = fiberMappingNodeBaseDepth(node);
  const fallbackPonKey = node?.ponId ? fiberMapNodeKey('pon', node.ponId) : '';
  const sourceKey = node?.sourceKey && node.sourceKey !== node.key ? node.sourceKey : fallbackPonKey;
  const sourceNode = sourceKey ? nodeMap.get(sourceKey) : null;
  if (sourceNode && sourceNode.key !== node.key) {
    depth = Math.max(depth, fiberMappingNodeConnectionDepth(sourceNode, nodeMap, memo, seen) + 1);
  }
  seen.delete(node.key);
  memo.set(node.key, depth);
  return depth;
}

function fiberMappingSpacingRect(node, size, gap = FIBER_MAPPING_STRICT_OVERLAP_GAP) {
  const spacing = Math.max(0, Number(gap) || 0) / 2;
  return {
    left: node.x - spacing,
    top: node.y - spacing,
    right: node.x + size.width + spacing,
    bottom: node.y + size.height + spacing
  };
}

function fiberMappingResolveNodeOverlaps(nodes = [], expandedContainerKeys = [], options = {}) {
  const visibleNodes = nodes.filter((node) => node?.key && node.visible !== false);
  if (visibleNodes.length < 2) return {};
  const protectedKeys = new Set(options.protectedKeys || []);
  const gap = Number.isFinite(Number(options.gap)) ? Number(options.gap) : FIBER_MAPPING_STRICT_OVERLAP_GAP;
  const nodeMap = new Map(visibleNodes.map((node) => [node.key, node]));
  const depthMemo = new Map();
  const working = visibleNodes.map((node, index) => {
    const x = Math.round(asNumber(node.x, 20));
    const y = Math.round(asNumber(node.y, 20));
    return {
      ...node,
      x,
      y,
      originalX: x,
      originalY: y,
      originalIndex: index,
      size: fiberMappingNodeVisualSize(node, expandedContainerKeys),
      depth: fiberMappingNodeConnectionDepth(node, nodeMap, depthMemo)
    };
  });
  const priority = (node) => {
    if (node.locked && !protectedKeys.has(node.key)) return 0;
    if (protectedKeys.has(node.key)) return 1;
    return 2;
  };
  const ordered = [...working].sort((left, right) => (
    priority(left) - priority(right)
    || left.depth - right.depth
    || left.originalY - right.originalY
    || left.originalX - right.originalX
    || left.originalIndex - right.originalIndex
  ));
  const placed = [];
  ordered.forEach((node) => {
    let guard = 0;
    let hasOverlap = true;
    while (hasOverlap && guard < 600) {
      hasOverlap = false;
      for (const blocker of placed) {
        if (!fiberMappingRectsOverlap(
          fiberMappingSpacingRect(node, node.size, gap),
          fiberMappingSpacingRect(blocker, blocker.size, gap)
        )) {
          continue;
        }
        hasOverlap = true;
        const sameLayer = node.depth === blocker.depth;
        const shouldMoveRight = !sameLayer && node.depth >= blocker.depth;
        if (shouldMoveRight) {
          node.x = Math.round(Math.max(20, blocker.x + blocker.size.width + gap));
        } else {
          node.y = Math.round(Math.max(20, blocker.y + blocker.size.height + gap));
        }
        break;
      }
      guard += 1;
    }
    placed.push(node);
  });
  return Object.fromEntries(
    working
      .filter((node) => node.x !== node.originalX || node.y !== node.originalY)
      .map((node) => [node.key, { x: Math.round(node.x), y: Math.round(node.y) }])
  );
}

function fiberMappingNodesWithPatches(nodes = [], patches = {}) {
  if (!Object.keys(patches || {}).length) return nodes;
  return nodes.map((node) => (patches[node.key] ? { ...node, ...patches[node.key] } : node));
}

function fiberMappingTreeSortNodes(left, right) {
  const typeOrder = { olt: 0, pon: 1, nap: 2, junction: 3 };
  const leftType = typeOrder[left?.type] ?? 9;
  const rightType = typeOrder[right?.type] ?? 9;
  if (leftType !== rightType) return leftType - rightType;
  if (left?.type === 'pon' || right?.type === 'pon') {
    const leftPort = Number(left?.source?.portNumber || left?.source?.port || 0);
    const rightPort = Number(right?.source?.portNumber || right?.source?.port || 0);
    if (leftPort !== rightPort) return leftPort - rightPort;
  }
  return String(left?.label || left?.key || '').localeCompare(String(right?.label || right?.key || ''));
}

function fiberMappingTreeLayout(nodes = [], edges = [], expandedContainerKeys = []) {
  const visibleNodes = nodes.filter((node) => node?.key && node.visible !== false);
  if (!visibleNodes.length) return { nodes: [], canvas: FIBER_MAPPING_CANVAS };
  const nodeMap = new Map(visibleNodes.map((node) => [node.key, node]));
  const childKeysByParent = new Map();
  const parentByChild = new Map();
  edges.forEach((edge) => {
    const fromKey = nodeMap.has(edge.fromKey) ? edge.fromKey : nodeMap.has(edge.fallbackFromKey) ? edge.fallbackFromKey : '';
    const toKey = nodeMap.has(edge.toKey) ? edge.toKey : '';
    if (!fromKey || !toKey || fromKey === toKey || parentByChild.has(toKey)) return;
    const children = childKeysByParent.get(fromKey) || [];
    children.push(toKey);
    childKeysByParent.set(fromKey, children);
    parentByChild.set(toKey, fromKey);
  });
  childKeysByParent.forEach((childKeys, parentKey) => {
    childKeysByParent.set(parentKey, [...childKeys].sort((leftKey, rightKey) => (
      fiberMappingTreeSortNodes(nodeMap.get(leftKey), nodeMap.get(rightKey))
    )));
  });
  const roots = visibleNodes
    .filter((node) => node.type === 'olt' || !parentByChild.has(node.key))
    .sort(fiberMappingTreeSortNodes);
  const sizes = new Map(visibleNodes.map((node) => [node.key, fiberMappingNodeVisualSize(node, expandedContainerKeys)]));
  const subtreeHeights = new Map();
  const subtreeHeight = (nodeKey, seen = new Set()) => {
    if (!nodeKey || seen.has(nodeKey)) return 0;
    if (subtreeHeights.has(nodeKey)) return subtreeHeights.get(nodeKey);
    const node = nodeMap.get(nodeKey);
    if (!node) return 0;
    const nextSeen = new Set([...seen, nodeKey]);
    const children = (childKeysByParent.get(nodeKey) || []).filter((childKey) => !nextSeen.has(childKey));
    const ownHeight = sizes.get(nodeKey)?.height || FIBER_MAPPING_NODE_SIZE.nap.height;
    const childrenHeight = children.reduce((total, childKey, index) => (
      total + subtreeHeight(childKey, nextSeen) + (index ? FIBER_MAPPING_TREE_ROW_GAP : 0)
    ), 0);
    const height = Math.max(ownHeight, childrenHeight);
    subtreeHeights.set(nodeKey, height);
    return height;
  };
  const positioned = new Map();
  let maxRight = FIBER_MAPPING_CANVAS.width;
  let maxBottom = FIBER_MAPPING_CANVAS.height;
  const placeNode = (nodeKey, depth, top, seen = new Set()) => {
    const node = nodeMap.get(nodeKey);
    if (!node || seen.has(nodeKey) || positioned.has(nodeKey)) return;
    const nextSeen = new Set([...seen, nodeKey]);
    const size = sizes.get(nodeKey) || FIBER_MAPPING_NODE_SIZE.nap;
    const treeHeight = subtreeHeight(nodeKey, nextSeen);
    const x = FIBER_MAPPING_TREE_LEFT + depth * FIBER_MAPPING_TREE_COLUMN_GAP;
    const y = top + Math.max(0, (treeHeight - size.height) / 2);
    positioned.set(nodeKey, {
      ...node,
      x: Math.round(x),
      y: Math.round(y),
      width: size.width,
      height: size.height,
      locked: false,
      systemControlled: true
    });
    maxRight = Math.max(maxRight, x + size.width + FIBER_MAPPING_TREE_RIGHT_PAD);
    maxBottom = Math.max(maxBottom, y + size.height + FIBER_MAPPING_TREE_BOTTOM_PAD);
    const children = (childKeysByParent.get(nodeKey) || []).filter((childKey) => !nextSeen.has(childKey));
    const childrenHeight = children.reduce((total, childKey, index) => (
      total + subtreeHeight(childKey, nextSeen) + (index ? FIBER_MAPPING_TREE_ROW_GAP : 0)
    ), 0);
    let childTop = top + Math.max(0, (treeHeight - childrenHeight) / 2);
    children.forEach((childKey, index) => {
      const childHeight = subtreeHeight(childKey, nextSeen);
      placeNode(childKey, depth + 1, childTop, nextSeen);
      childTop += childHeight + FIBER_MAPPING_TREE_ROW_GAP;
    });
  };
  let cursorY = FIBER_MAPPING_TREE_TOP;
  roots.forEach((rootKeyOrNode) => {
    const rootKey = typeof rootKeyOrNode === 'string' ? rootKeyOrNode : rootKeyOrNode.key;
    const height = subtreeHeight(rootKey);
    placeNode(rootKey, 0, cursorY);
    cursorY += height + FIBER_MAPPING_TREE_ROOT_GAP;
  });
  visibleNodes
    .filter((node) => !positioned.has(node.key))
    .sort(fiberMappingTreeSortNodes)
    .forEach((node) => {
      const height = subtreeHeight(node.key);
      placeNode(node.key, 0, cursorY);
      cursorY += height + FIBER_MAPPING_TREE_ROOT_GAP;
    });
  const treeNodes = visibleNodes.map((node) => positioned.get(node.key) || node);
  return {
    nodes: treeNodes,
    canvas: {
      width: Math.max(FIBER_MAPPING_CANVAS.width, maxRight),
      height: Math.max(FIBER_MAPPING_CANVAS.height, maxBottom)
    }
  };
}

function fiberMappingReflowPatchesForExpandedContainer(containerKey, nodes = [], expandedContainerKeys = []) {
  const expandedNode = nodes.find((node) => node.key === containerKey);
  if (!expandedNode || !['nap', 'junction'].includes(expandedNode.type)) return {};
  const beforeExpandedKeys = expandedContainerKeys.filter((key) => key !== containerKey);
  const afterExpandedKeys = [...new Set([...beforeExpandedKeys, containerKey])];
  const beforeSize = fiberMappingNodeVisualSize(expandedNode, beforeExpandedKeys);
  const afterSize = fiberMappingNodeVisualSize(expandedNode, afterExpandedKeys);
  const deltaX = Math.max(0, afterSize.width - beforeSize.width) + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  const deltaY = Math.max(0, afterSize.height - beforeSize.height) + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  if (deltaX <= FIBER_MAPPING_EXPAND_REFLOW_GAP && deltaY <= FIBER_MAPPING_EXPAND_REFLOW_GAP) return {};

  const expandedRect = fiberMappingNodeRect(expandedNode, afterSize);
  const pressureRect = {
    left: expandedRect.left - FIBER_MAPPING_EXPAND_REFLOW_GAP,
    top: expandedRect.top - FIBER_MAPPING_EXPAND_REFLOW_GAP,
    right: expandedRect.right + FIBER_MAPPING_EXPAND_REFLOW_GAP,
    bottom: expandedRect.bottom + FIBER_MAPPING_EXPAND_REFLOW_GAP
  };
  const wouldCollide = nodes.some((node) => {
    if (node.key === containerKey) return false;
    const size = fiberMappingNodeVisualSize(node, expandedContainerKeys);
    return fiberMappingRectsOverlap(fiberMappingNodeRect(node, size), pressureRect);
  });
  if (!wouldCollide) return {};

  const patches = {};
  nodes.forEach((node) => {
    if (node.key === containerKey) return;
    const size = fiberMappingNodeVisualSize(node, expandedContainerKeys);
    const rect = fiberMappingNodeRect(node, size);
    const sharesExpandedRow = node.x > expandedNode.x
      && fiberMappingRangesOverlap(rect.top, rect.bottom, pressureRect.top, pressureRect.bottom);
    const sharesExpandedColumn = node.y > expandedNode.y
      && fiberMappingRangesOverlap(rect.left, rect.right, pressureRect.left, pressureRect.right);
    if (!sharesExpandedRow && !sharesExpandedColumn) return;
    patches[node.key] = {
      x: Math.round(Math.max(20, node.x + (sharesExpandedRow ? deltaX : 0))),
      y: Math.round(Math.max(20, node.y + (!sharesExpandedRow && sharesExpandedColumn ? deltaY : 0)))
    };
  });
  return patches;
}

function fiberMappingReflowPatchesForCollapsedContainer(containerKey, nodes = [], expandedContainerKeys = []) {
  const collapsedNode = nodes.find((node) => node.key === containerKey);
  if (!collapsedNode || !['nap', 'junction'].includes(collapsedNode.type)) return {};
  const beforeExpandedKeys = [...new Set([...expandedContainerKeys, containerKey])];
  const afterExpandedKeys = beforeExpandedKeys.filter((key) => key !== containerKey);
  const beforeSize = fiberMappingNodeVisualSize(collapsedNode, beforeExpandedKeys);
  const afterSize = fiberMappingNodeVisualSize(collapsedNode, afterExpandedKeys);
  const deltaX = Math.max(0, beforeSize.width - afterSize.width) + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  const deltaY = Math.max(0, beforeSize.height - afterSize.height) + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  if (deltaX <= FIBER_MAPPING_EXPAND_REFLOW_GAP && deltaY <= FIBER_MAPPING_EXPAND_REFLOW_GAP) return {};

  const beforeRect = fiberMappingNodeRect(collapsedNode, beforeSize);
  const afterRect = fiberMappingNodeRect(collapsedNode, afterSize);
  const rowBand = {
    top: beforeRect.top - FIBER_MAPPING_EXPAND_REFLOW_GAP,
    bottom: beforeRect.bottom + FIBER_MAPPING_EXPAND_REFLOW_GAP
  };
  const columnBand = {
    left: beforeRect.left - FIBER_MAPPING_EXPAND_REFLOW_GAP,
    right: beforeRect.right + FIBER_MAPPING_EXPAND_REFLOW_GAP
  };
  const compactRightLimit = afterRect.right + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  const compactBottomLimit = afterRect.bottom + FIBER_MAPPING_EXPAND_REFLOW_GAP;
  const patches = {};
  nodes.forEach((node) => {
    if (node.key === containerKey) return;
    const size = fiberMappingNodeVisualSize(node, expandedContainerKeys);
    const rect = fiberMappingNodeRect(node, size);
    const sharesExpandedRow = node.x > collapsedNode.x
      && fiberMappingRangesOverlap(rect.top, rect.bottom, rowBand.top, rowBand.bottom);
    const sharesExpandedColumn = node.y > collapsedNode.y
      && fiberMappingRangesOverlap(rect.left, rect.right, columnBand.left, columnBand.right);
    if (sharesExpandedRow) {
      const nextX = Math.round(Math.max(compactRightLimit, node.x - deltaX));
      if (nextX < node.x) patches[node.key] = { x: nextX, y: Math.round(node.y) };
      return;
    }
    if (sharesExpandedColumn) {
      const nextY = Math.round(Math.max(compactBottomLimit, node.y - deltaY));
      if (nextY < node.y) patches[node.key] = { x: Math.round(node.x), y: nextY };
    }
  });
  return patches;
}

function fiberMappingNodeAnchorSize(node, expandedContainerKeys = []) {
  const isContainer = ['nap', 'junction'].includes(node?.type);
  if (isContainer && expandedContainerKeys.includes(node.key)) {
    return fiberMappingExpandedContainerSize(node);
  }
  if (!isContainer) {
    return { width: node.width, height: node.height };
  }
  const hasSummary = Array.isArray(node.splitterAssignments) && node.splitterAssignments.length > 0;
  return {
    width: fiberMappingCollapsedContainerAnchorWidth(node, hasSummary),
    height: hasSummary
      ? FIBER_MAPPING_CONTAINER_COLLAPSED_ANCHOR_HEIGHT.summary
      : FIBER_MAPPING_CONTAINER_COLLAPSED_ANCHOR_HEIGHT.empty
  };
}

const defaultFiberLinkSettings = {
  maxLinePixels: 500,
  minLinePixels: 80
};

const blankFiberMapping = {
  nodes: {},
  edges: {},
  napSplitters: {},
  junctionBoxes: {},
  containerSplitters: {},
  containerSplitterAssignments: {},
  connectionPoints: {},
  fiberLinkSettings: defaultFiberLinkSettings,
  updatedAt: ''
};

const FIBER_MAPPING_CANVAS = { width: 2800, height: 1600 };
const FIBER_MAPPING_NODE_SIZE = {
  olt: { width: 240, height: 104 },
  pon: { width: 220, height: 94 },
  nap: { width: 260, height: 142 },
  junction: { width: 260, height: 142 }
};
const FIBER_MAPPING_CONTAINER_COLLAPSED_ANCHOR_HEIGHT = {
  empty: 54,
  summary: 84
};
const FIBER_MAPPING_GROUP_TOP = 120;
const FIBER_MAPPING_OLT_GAP = 220;
const FIBER_MAPPING_PON_SPACING = 118;
const FIBER_MAPPING_TREE_LEFT = 72;
const FIBER_MAPPING_TREE_TOP = 96;
const FIBER_MAPPING_TREE_COLUMN_GAP = 310;
const FIBER_MAPPING_TREE_ROW_GAP = 36;
const FIBER_MAPPING_TREE_ROOT_GAP = 92;
const FIBER_MAPPING_TREE_RIGHT_PAD = 160;
const FIBER_MAPPING_TREE_BOTTOM_PAD = 120;
const FIBER_INTERNAL_CANVAS = {
  minWidth: 440,
  modalMinWidth: 1080,
  height: 330,
  inputX: 34,
  outputGap: 64,
  branchLength: 96
};
const FIBER_MAPPING_EXPANDED_CONTAINER_CHROME = { width: 28, height: 98 };
const FIBER_MAPPING_EXPAND_REFLOW_GAP = 36;
const FIBER_MAPPING_STRICT_OVERLAP_GAP = 42;
const FIBER_FBT_RATIO_LABEL_END_OFFSET = 24;
const FIBER_CONNECTION_TYPES = [
  { value: 'FUSION', label: 'Fusion' },
  { value: 'MECHANICAL', label: 'Mechanical' },
  { value: 'SC_CONNECTOR', label: 'SC Connector' }
];

function normalizeFiberLinkSettings(settings = {}) {
  const source = settings || {};
  const maxLinePixels = clamp(Math.round(Number(source.maxLinePixels) || defaultFiberLinkSettings.maxLinePixels), 160, 1200);
  const minLinePixels = clamp(Math.round(Number(source.minLinePixels) || defaultFiberLinkSettings.minLinePixels), 40, maxLinePixels);
  return { maxLinePixels, minLinePixels };
}

function fiberLinkLengthKm(edge) {
  const lengthKm = cleanNumber(edge?.config?.lengthKm);
  return lengthKm !== null && lengthKm > 0 ? lengthKm : 0;
}

function fiberLinkSegmentPixels(lengthKm, maxLengthKm, settings) {
  const normalized = normalizeFiberLinkSettings(settings);
  if (!lengthKm || !maxLengthKm) return normalized.minLinePixels;
  const range = normalized.maxLinePixels - normalized.minLinePixels;
  return clamp(Math.round(normalized.minLinePixels + (lengthKm / maxLengthKm) * range), normalized.minLinePixels, normalized.maxLinePixels);
}

function fiberConnectionTypeLabel(value) {
  return FIBER_CONNECTION_TYPES.find((entry) => entry.value === value)?.label || 'Fusion';
}

function fiberConnectionTypeClass(value) {
  return String(value || 'FUSION').toLowerCase().replace(/_/g, '-');
}

function fiberCoreOptionsForProfile(profile) {
  if (!profile) return [];
  const coreCount = normalizeFiberCoreCount(profile.coreCount, fiberCoreCountFromGroups(profile.colorGroups) || 12);
  const groups = Array.isArray(profile.colorGroups) && profile.colorGroups.length
    ? profile.colorGroups
    : buildFiberColorGroups(coreCount, defaultFiberColorSettings);
  return groups
    .flatMap((group) => {
      const cores = Array.isArray(group?.cores) ? group.cores : [];
      return cores.map((core, index) => {
        const fiberNumber = Number.parseInt(core.fiberNumber || core.position || index + 1, 10) || index + 1;
        return {
          fiberNumber,
          colorName: core.colorName || core.name || `Core ${fiberNumber}`,
          colorHex: normalizeHexColor(core.colorHex || core.hex, defaultFiberColorEntries[(fiberNumber - 1) % defaultFiberColorEntries.length].hex),
          tubeName: group.tubeColorName || '',
          tubeHex: group.tubeColorHex || ''
        };
      });
    })
    .sort((left, right) => left.fiberNumber - right.fiberNumber);
}

function fiberCoreNumberForConfig(config = {}, profile = null) {
  const options = fiberCoreOptionsForProfile(profile);
  const requested = Number.parseInt(config?.fiberCoreNumber, 10);
  if (Number.isFinite(requested) && options.some((option) => option.fiberNumber === requested)) return requested;
  return options[0]?.fiberNumber || 1;
}

function fiberCoreOptionForConfig(config = {}, profile = null) {
  const options = fiberCoreOptionsForProfile(profile);
  const coreNumber = fiberCoreNumberForConfig(config, profile);
  return options.find((option) => option.fiberNumber === coreNumber) || null;
}

function fiberLineColorForConfig(config = {}, profile = null) {
  const core = fiberCoreOptionForConfig(config, profile);
  return normalizeHexColor(core?.colorHex, config?.lineColor || '#2563EB');
}

function fiberCoreLabelForConfig(config = {}, profile = null) {
  const core = fiberCoreOptionForConfig(config, profile);
  if (!core) return 'Core 1';
  return `Core ${core.fiberNumber}${core.colorName ? ` / ${core.colorName}` : ''}`;
}

function formatFiberDistanceKm(lengthKm) {
  const distance = cleanNumber(lengthKm);
  if (distance === null || distance <= 0) return '';
  if (distance < 1) return `${Math.round(distance * 1000)} m`;
  return `${distance.toFixed(3)} km`;
}

function normalizeFiberMapping(mapping) {
  const napSplitters = { ...(mapping?.napSplitters || {}) };
  const containerSplitters = { ...(mapping?.containerSplitters || {}) };
  const containerSplitterAssignments = { ...(mapping?.containerSplitterAssignments || {}) };
  Object.entries(napSplitters).forEach(([napId, splitterIds]) => {
    const key = fiberMapNodeKey('nap', napId);
    if (!containerSplitters[key]) containerSplitters[key] = splitterIds;
  });
  Object.entries(containerSplitters).forEach(([containerKey, splitterIds]) => {
    if (containerSplitterAssignments[containerKey] || !Array.isArray(splitterIds)) return;
    containerSplitterAssignments[containerKey] = splitterIds.map((splitterId, index) => ({
      assignmentId: `${splitterId}-${index + 1}`,
      splitterId,
      ratio: ''
    }));
  });
  return {
    ...blankFiberMapping,
    ...(mapping || {}),
    nodes: { ...(mapping?.nodes || {}) },
    edges: { ...(mapping?.edges || {}) },
    napSplitters,
    junctionBoxes: { ...(mapping?.junctionBoxes || {}) },
    containerSplitters,
    containerSplitterAssignments,
    connectionPoints: { ...(mapping?.connectionPoints || {}) },
    fiberLinkSettings: normalizeFiberLinkSettings(mapping?.fiberLinkSettings)
  };
}

function fiberMapNodeKey(type, id) {
  return `${type}:${id}`;
}

function fiberMapEdgeKey(fromKey, toKey) {
  return `${fromKey}->${toKey}`;
}

function fiberMapConnectionPointKey(containerKey, splitterId, terminal) {
  return `${containerKey}|${splitterId}|${terminal}`;
}

function fiberMapSplitterSelectionKey(containerKey, assignmentId) {
  return `${containerKey}|${assignmentId}`;
}

function parseFiberMapSplitterSelectionKey(value) {
  const [containerKey = '', assignmentId = ''] = String(value || '').split('|');
  return { containerKey, assignmentId };
}

function makeFiberMappingAssignmentId(splitterId) {
  const suffix = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${splitterId}-${suffix}`;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function defaultFiberEdgeConfig() {
  return {
    fiberOpticLossId: '',
    fiberCoreNumber: '1',
    wavelengthNm: defaultMeta.wavelengthsNm[0],
    lengthKm: '',
    sourcePowerDbm: '',
    connectorLossDb: '',
    spliceLossDb: '',
    connectionType: 'FUSION',
    lineStyle: 'SOLID',
    lineColor: '#2563EB',
    mapBendPoints: [],
    notes: ''
  };
}

function normalizeMapBendPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, 24).map((point) => {
    const latitude = cleanNumber(point?.latitude);
    const longitude = cleanNumber(point?.longitude);
    const x = cleanNumber(point?.x);
    const y = cleanNumber(point?.y);
    const record = {};
    if (latitude !== null && longitude !== null) {
      record.latitude = clamp(latitude, -90, 90);
      record.longitude = clamp(longitude, -180, 180);
    }
    if (x !== null && y !== null) {
      record.x = clamp(x, 0, 12000);
      record.y = clamp(y, 0, 12000);
    }
    return record;
  }).filter((point) => (
    (Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    || (Number.isFinite(point.x) && Number.isFinite(point.y))
  ));
}

function mapLinkPath(points) {
  const safePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!safePoints.length) return '';
  return safePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function serviceabilityCutLineSegments(start, end, gap = 28) {
  if (!start || !end) return [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= gap * 2) return [[start, end]];
  const unitX = dx / length;
  const unitY = dy / length;
  const midpoint = {
    x: start.x + dx / 2,
    y: start.y + dy / 2
  };
  return [
    [start, { x: midpoint.x - unitX * gap, y: midpoint.y - unitY * gap }],
    [{ x: midpoint.x + unitX * gap, y: midpoint.y + unitY * gap }, end]
  ];
}

function pointToSegmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return ((point.x - start.x) ** 2) + ((point.y - start.y) ** 2);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  return ((point.x - projectedX) ** 2) + ((point.y - projectedY) ** 2);
}

function nearestMapLinkSegmentIndex(points, point) {
  if (points.length < 2) return 0;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = pointToSegmentDistanceSquared(point, points[index], points[index + 1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

function fiberLossForProfile(profile, wavelengthNm) {
  if (!profile) return 0;
  return cleanNumber(profile[`loss${wavelengthNm}DbPer1000m`]) ?? 0;
}

function splitterLossForWavelength(splitter, wavelengthNm) {
  const splitterType = normalizeSplitterType(splitter?.splitterType);
  if (isPortLossSplitterType(splitterType)) {
    const rows = Array.isArray(splitter?.portLosses) ? splitter.portLosses : [];
    const losses = rows.map((row) => cleanNumber(row.insertionLossDb)).filter((value) => value !== null);
    if (losses.length) return losses.reduce((total, value) => total + value, 0) / losses.length;
    return cleanNumber(splitter?.insertionLossDb) ?? 0;
  }
  const rows = Array.isArray(splitter?.ratioRows) ? splitter.ratioRows : [];
  const firstRow = rows.find((row) => (
    cleanNumber(row[`connectorLoss${wavelengthNm}Db`]) !== null
    || cleanNumber(row[`currentNapLoss${wavelengthNm}Db`]) !== null
    || cleanNumber(row[`nextNapLoss${wavelengthNm}Db`]) !== null
  ));
  if (firstRow) {
    return [
      firstRow[`connectorLoss${wavelengthNm}Db`],
      firstRow[`currentNapLoss${wavelengthNm}Db`],
      firstRow[`nextNapLoss${wavelengthNm}Db`]
    ].reduce((total, value) => total + (cleanNumber(value) ?? 0), 0);
  }
  return cleanNumber(splitter?.insertionLossDb) ?? 0;
}

function fiberMappingEdgeBudget(edgeConfig, edge, fiberOptics, splittersById, ponsById) {
  const config = { ...defaultFiberEdgeConfig(), ...(edgeConfig || {}) };
  const wavelength = config.wavelengthNm || defaultMeta.wavelengthsNm[0];
  const profile = fiberOptics.find((row) => row.id === config.fiberOpticLossId);
  const parentPon = edge?.ponId ? ponsById.get(edge.ponId) : null;
  const sourcePower = cleanNumber(config.sourcePowerDbm) ?? cleanNumber(parentPon?.moduleRxPowerDbm);
  const lengthKm = cleanNumber(config.lengthKm) ?? 0;
  const fiberLossDb = fiberLossForProfile(profile, wavelength) * lengthKm;
  const connectorLossDb = cleanNumber(config.connectorLossDb) ?? 0;
  const spliceLossDb = cleanNumber(config.spliceLossDb) ?? 0;
  const splitterLossDb = (edge?.splitterIds || []).reduce((total, splitterId) => total + splitterLossForWavelength(splittersById.get(splitterId), wavelength), 0);
  const totalLossDb = fiberLossDb + connectorLossDb + spliceLossDb + splitterLossDb;
  return {
    wavelength,
    profile,
    sourcePower,
    lengthKm,
    fiberLossDb,
    connectorLossDb,
    spliceLossDb,
    splitterLossDb,
    totalLossDb,
    receivePowerDbm: sourcePower === null ? null : sourcePower - totalLossDb
  };
}

function normalizeFiberOpticForm(profile, settings = defaultFiberColorSettings) {
  const base = makeBlankFiberOptic(settings);
  const merged = { ...base, ...profile };
  const coreCount = normalizeFiberCoreCount(merged.coreCount, fiberCoreCountFromGroups(merged.colorGroups) || Number(base.coreCount));
  return {
    ...merged,
    coreCount: String(coreCount),
    colorGroups: buildFiberColorGroups(coreCount, settings, merged.colorGroups)
  };
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
  colorHex: PON_COLOR_BASES[0],
  technology: 'GPON',
  adminStatus: 'ENABLED',
  operationalStatus: 'UNKNOWN',
  splitRatio: '1:128',
  serviceVlan: '',
  capacity: '128',
  moduleVendor: '',
  moduleRxPowerDbm: '',
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
  splitterType: 'FBT',
  splitRatio: '5:95',
  inputPorts: '1',
  outputPorts: '2',
  portNumber: '',
  portCapacity: '2',
  insertionLossDb: '',
  connectorType: 'BARE_FIBER',
  packageType: 'STEEL_TUBE',
  stage: 'TAP',
  manufacturer: '',
  brand: '',
  model: '',
  serialNumber: '',
  connectorLoss1310Db: '',
  connectorLoss1490Db: '',
  connectorLoss1550Db: '',
  currentNapLoss1310Db: '',
  currentNapLoss1490Db: '',
  currentNapLoss1550Db: '',
  nextNapLoss1310Db: '',
  nextNapLoss1490Db: '',
  nextNapLoss1550Db: '',
  ratioRows: [],
  visibleWavelengths: ['1310', '1490', '1550'],
  ratioProfiles: [],
  portLosses: [],
  lcpCabinet: '',
  lcpSlot: '',
  status: 'ACTIVE',
  locationHint: '',
  notes: ''
};

const blankFiberOptic = makeBlankFiberOptic(defaultFiberColorSettings);

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

async function loadServiceabilityCustomerProfiles() {
  const pageSize = 100;
  const baseParams = new URLSearchParams({
    pageSize: String(pageSize),
    sortBy: 'fullName',
    sortDir: 'asc'
  });
  const firstPage = await request(`/customer-profiling/customers?${baseParams.toString()}`);
  const rows = Array.isArray(firstPage?.data) ? [...firstPage.data] : [];
  const totalPages = Math.max(1, Number(firstPage?.totalPages) || 1);
  if (totalPages <= 1) return rows;
  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(index + 2));
      return request(`/customer-profiling/customers?${params.toString()}`).catch(() => ({ data: [] }));
    })
  );
  remainingPages.forEach((page) => {
    if (Array.isArray(page?.data)) rows.push(...page.data);
  });
  return rows;
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

function rowCoordinates(row) {
  const lat = parseCoordinate(row?.latitude);
  const lng = parseCoordinate(row?.longitude);
  if (lat === null || lng === null) return null;
  return { latitude: lat, longitude: lng };
}

function haversineMeters(left, right) {
  if (!left || !right) return null;
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);
  const deltaLat = toRadians(right.latitude - left.latitude);
  const deltaLng = toRadians(right.longitude - left.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(deltaLng / 2) ** 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceMeters(distance) {
  const value = Number(distance);
  if (!Number.isFinite(value)) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 2)} km`;
  return `${Math.round(value)} m`;
}

function formatServiceabilityPorts(nap) {
  if (!nap) return '-';
  const remaining = Number(nap.remainingPorts);
  const capacity = Number(nap.capacity);
  if (Number.isFinite(remaining) && Number.isFinite(capacity)) return `${remaining}/${capacity}`;
  return nap.customerMapped ? 'Mapped' : '-';
}

function customerDisplayName(customer) {
  return customer?.fullName || [customer?.firstName, customer?.middleName, customer?.lastName].filter(Boolean).join(' ') || customer?.businessName || 'Customer';
}

function customerServiceAddress(customer) {
  return [
    customer?.addressLine1,
    customer?.addressLine2,
    customer?.barangay,
    customer?.city,
    customer?.province
  ].filter(Boolean).join(', ');
}

function normalizeServiceabilityLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:barangay|brgy|purok|sitio|zone)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function serviceabilityLocationValues(row) {
  const values = [
    row?.barangay,
    row?.locationName,
    row?.location,
    row?.serviceLocation,
    row?.addressLine2
  ].map(normalizeServiceabilityLocation).filter((value) => value.length >= 3);
  return [...new Set(values)];
}

function serviceabilityLocationLabel(row) {
  return [
    row?.barangay,
    row?.locationName,
    row?.city,
    row?.province
  ].filter(Boolean).join(', ') || 'customer location';
}

function serviceabilityNapMatchesCustomer(customer, napCandidate) {
  const customerLocations = serviceabilityLocationValues(customer);
  if (!customerLocations.length) return false;
  const napLocations = serviceabilityLocationValues(napCandidate?.sourceNap || napCandidate);
  if (!napLocations.length) return false;
  return customerLocations.some((customerLocation) => napLocations.some((napLocation) => (
    customerLocation === napLocation
    || customerLocation.includes(napLocation)
    || napLocation.includes(customerLocation)
  )));
}

function serviceabilityCandidatesForCustomer(customer, candidates) {
  if (!customer) return candidates;
  return candidates.filter((candidate) => serviceabilityNapMatchesCustomer(customer, candidate));
}

function valueAtPath(row, path) {
  return String(path || '').split('.').reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), row);
}

function firstTextAtPaths(row, paths = []) {
  for (const path of paths) {
    const value = valueAtPath(row, path);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function firstNumberAtPaths(row, paths = []) {
  for (const path of paths) {
    const value = valueAtPath(row, path);
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function serviceabilityCustomerMapping(customer) {
  if (!customer) return { napId: '', splitterId: '', assignmentId: '', portNumber: 0 };
  return {
    napId: firstTextAtPaths(customer, [
      'mappedNapId',
      'mappedNapBoxId',
      'assignedNapId',
      'assignedNapBoxId',
      'serviceNapId',
      'serviceNapBoxId',
      'networkNapId',
      'networkNapBoxId',
      'serviceabilityNapId',
      'serviceabilityNapBoxId',
      'napId',
      'napBoxId',
      'networkMapping.napId',
      'networkMapping.napBoxId',
      'serviceability.napId',
      'serviceability.napBoxId',
      'installation.napId',
      'installation.napBoxId'
    ]),
    splitterId: firstTextAtPaths(customer, [
      'mappedSplitterId',
      'assignedSplitterId',
      'serviceSplitterId',
      'serviceabilitySplitterId',
      'splitterId',
      'networkMapping.splitterId',
      'serviceability.splitterId',
      'installation.splitterId'
    ]),
    assignmentId: firstTextAtPaths(customer, [
      'mappedSplitterAssignmentId',
      'splitterAssignmentId',
      'networkMapping.splitterAssignmentId',
      'serviceability.splitterAssignmentId',
      'installation.splitterAssignmentId'
    ]),
    portNumber: firstNumberAtPaths(customer, [
      'mappedNapPort',
      'mappedPortNumber',
      'mappedSplitterPort',
      'splitterPort',
      'splitterPortNumber',
      'napPort',
      'napPortNumber',
      'servicePortNumber',
      'serviceabilityPortNumber',
      'fiberPortNumber',
      'networkMapping.portNumber',
      'networkMapping.splitterPortNumber',
      'serviceability.portNumber',
      'serviceability.splitterPortNumber',
      'installation.portNumber',
      'installation.splitterPortNumber'
    ])
  };
}

function sameServiceabilityId(left, right) {
  return String(left || '').trim() && String(left || '').trim() === String(right || '').trim();
}

function serviceabilityCandidateForMappedCustomer(customer, candidates = []) {
  const mapping = serviceabilityCustomerMapping(customer);
  if (!mapping.napId) return null;
  return candidates.find((candidate) => sameServiceabilityId(candidate.sourceId, mapping.napId)) || null;
}

function serviceabilityCandidatesForSelectedCustomer(customer, candidates = []) {
  const locationCandidates = serviceabilityCandidatesForCustomer(customer, candidates);
  const mappedCandidate = serviceabilityCandidateForMappedCustomer(customer, candidates);
  if (!mappedCandidate || locationCandidates.some((candidate) => candidate.sourceId === mappedCandidate.sourceId)) {
    return locationCandidates;
  }
  return [mappedCandidate, ...locationCandidates];
}

function serviceabilitySplitterOutputPorts(assignment = {}) {
  const splitter = assignment.splitter || {};
  const ratio = assignment.ratio || splitter.splitRatio || (splitter.outputPorts ? `1:${splitter.outputPorts}` : '');
  return splitterOutputPortsFromRatio(ratio, Number(splitter.outputPorts || splitter.portCapacity || 0));
}

function serviceabilitySplitterPortLosses(assignment = {}) {
  const splitter = assignment.splitter || {};
  if (!isPortLossSplitterType(splitter.splitterType)) return [];
  const ratio = normalizeSplitterRatioValue(assignment.ratio || splitter.splitRatio || '');
  const profile = Array.isArray(splitter.ratioProfiles)
    ? splitter.ratioProfiles.find((row) => normalizeSplitterRatioValue(row?.splitRatio || row?.ratio) === ratio)
    : null;
  return compactSplitterPortLossRows(profile?.portLosses || splitter.portLosses);
}

function serviceabilityTopologyForNap(napId, mapping, splittersById) {
  const containerKey = fiberMapNodeKey('nap', napId);
  const rawAssignments = mapping.containerSplitterAssignments?.[containerKey] || [];
  const splitterAssignments = rawAssignments.map((assignment, index) => {
    const splitter = splittersById.get(assignment.splitterId);
    if (!splitter) return null;
    const splitterType = normalizeSplitterType(splitter.splitterType);
    const outputPorts = serviceabilitySplitterOutputPorts({ ...assignment, splitter });
    return {
      ...assignment,
      assignmentId: assignment.assignmentId || `${assignment.splitterId}-${index + 1}`,
      splitter,
      splitterType,
      outputPorts,
      portLosses: serviceabilitySplitterPortLosses({ ...assignment, splitter })
    };
  }).filter(Boolean);
  const primarySplitter = [...splitterAssignments].reverse().find((assignment) => isPortLossSplitterType(assignment.splitterType))
    || splitterAssignments.find((assignment) => isPortLossSplitterType(assignment.splitterType))
    || null;
  return {
    containerKey,
    splitterAssignments,
    primarySplitter,
    topologyCapacity: primarySplitter?.outputPorts || 0
  };
}

function napServiceCapacity(nap) {
  const ratioCapacity = splitterOutputPortsFromRatio(normalizeNapSplitterRatio(nap?.splitterRatio), Number(nap?.portCapacity || 0));
  const capacity = Number(nap?.portCapacity || ratioCapacity || 0);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : ratioCapacity || 0;
}

function napUsedServicePorts(nap) {
  const raw = Number(nap?.usedPorts ?? nap?.occupiedPorts ?? nap?.assignedCustomerCount ?? nap?.customerCount ?? nap?.activeCustomerCount ?? nap?.fbtCount ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function napRemainingServicePorts(nap) {
  return Math.max(0, napServiceCapacity(nap) - napUsedServicePorts(nap));
}

function serviceabilityStatusMeta(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'MAPPED') {
    return { label: 'Mapped', tone: 'blue', icon: IconPlugConnected };
  }
  if (normalized === 'SERVICEABLE') {
    return { label: 'Serviceable', tone: 'green', icon: IconHomeSignal };
  }
  if (normalized === 'NO_PORTS') {
    return { label: 'No Ports', tone: 'red', icon: IconHomeOff };
  }
  if (normalized === 'NEEDS_COORDINATES') {
    return { label: 'Needs Coordinates', tone: 'yellow', icon: IconMapPin };
  }
  if (normalized === 'NO_NAP') {
    return { label: 'No NAP', tone: 'red', icon: IconHomeOff };
  }
  return { label: 'Unchecked', tone: 'secondary', icon: IconHome };
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

function displayOrderValue(row) {
  const value = Number(row?.displayOrder);
  return Number.isFinite(value) && value > 0 ? value : 1000000;
}

function sortByDisplayOrder(left, right) {
  const byOrder = displayOrderValue(left) - displayOrderValue(right);
  if (byOrder) return byOrder;
  const leftTime = String(left?.createdAt || left?.updatedAt || '');
  const rightTime = String(right?.createdAt || right?.updatedAt || '');
  const byTime = leftTime.localeCompare(rightTime);
  if (byTime) return byTime;
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

function sortNetworkDeviceRows(left, right) {
  const byAccess = String(left?.accessMethod || '').localeCompare(String(right?.accessMethod || ''));
  if (byAccess) return byAccess;
  const byType = String(left?.deviceType || '').localeCompare(String(right?.deviceType || ''));
  if (byType) return byType;
  return sortByDisplayOrder(left, right);
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

function mapTileUrl(x, y, z, provider = null) {
  return mapProviderTileUrl(provider || defaultMapProvider(), x, y, z);
}

function maxNativeTileZoomForMode(provider = null) {
  if (provider && typeof provider === 'object') {
    const maxZoom = Number(provider.maxZoom);
    return Number.isFinite(maxZoom) ? maxZoom : MAP_MAX_NATIVE_TILE_ZOOM;
  }
  return MAP_MAX_NATIVE_TILE_ZOOM_BY_MODE[provider] || MAP_MAX_NATIVE_TILE_ZOOM;
}

function mapTileSignature(tiles = []) {
  return tiles.map((tile) => tile.id).join('|');
}

function normalizeMapLayerVisibility(value = {}) {
  return {
    ...MAP_LAYER_VISIBILITY_DEFAULTS,
    ...Object.fromEntries(
      Object.keys(MAP_LAYER_VISIBILITY_DEFAULTS).map((key) => [key, typeof value[key] === 'boolean' ? value[key] : MAP_LAYER_VISIBILITY_DEFAULTS[key]])
    )
  };
}

function readMapPreferences() {
  const fallback = {
    providerId: '',
    highDetail: true,
    layerVisibility: MAP_LAYER_VISIBILITY_DEFAULTS
  };
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MAP_PREFERENCES_STORAGE_KEY) || '{}');
    const providerId = String(parsed.providerId || MAP_PROVIDER_FALLBACKS[parsed.tileMode] || parsed.tileMode || fallback.providerId).trim();
    return {
      providerId,
      highDetail: typeof parsed.highDetail === 'boolean' ? parsed.highDetail : fallback.highDetail,
      layerVisibility: normalizeMapLayerVisibility(parsed.layerVisibility)
    };
  } catch {
    return fallback;
  }
}

function writeMapPreferences(preferences) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const providerId = String(preferences.providerId || MAP_PROVIDER_FALLBACKS[preferences.tileMode] || preferences.tileMode || '').trim();
    window.localStorage.setItem(MAP_PREFERENCES_STORAGE_KEY, JSON.stringify({
      providerId,
      highDetail: Boolean(preferences.highDetail),
      layerVisibility: normalizeMapLayerVisibility(preferences.layerVisibility)
    }));
  } catch {
    // Browser storage can be unavailable in private contexts; the page still works without persistence.
  }
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
  const powerDbm = String(pon.moduleRxPowerDbm || '').trim();
  const source = String(pon.moduleSource || '').trim();
  const hasModuleData = vendor || powerDbm;
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
      <strong>{vendor || 'PON module'}</strong>
      <span>Power {formatDbm(powerDbm)}</span>
      <small>{source || 'Manual'}</small>
    </td>
  );
}

function PonColorCell({ pon, palette, saving, onChange }) {
  const color = ponColor(pon, palette);
  return (
    <td className="network-pon-color-cell">
      <label className="network-pon-color-picker" title={`Set color for ${pon.label || canonicalPonLabel(pon)}`}>
        <input
          type="color"
          value={color}
          disabled={saving}
          onChange={(event) => onChange(pon, event.target.value)}
        />
        <span style={{ backgroundColor: color }} />
      </label>
      <small>{color}</small>
    </td>
  );
}

function LossTriplet({ record, prefix, unit = 'dB' }) {
  const wavelengths = defaultMeta.wavelengthsNm;
  return (
    <div className="network-loss-triplet">
      {wavelengths.map((wavelength) => {
        const key = `${prefix}${wavelength}Db${unit === 'dB / 1000m' ? 'Per1000m' : ''}`;
        const value = record?.[key];
        return (
          <span key={wavelength}>
            <strong>{wavelength}</strong>
            {value ? `${value} ${unit}` : '-'}
          </span>
        );
      })}
    </div>
  );
}

function FiberColorSwatch({ color, label }) {
  return (
    <span
      className="network-fiber-swatch"
      style={{ backgroundColor: normalizeHexColor(color, '#64748B') }}
      title={label || color}
      aria-hidden="true"
    />
  );
}

function FiberColorGroupSummary({ profile }) {
  const groups = Array.isArray(profile?.colorGroups) && profile.colorGroups.length
    ? profile.colorGroups
    : buildFiberColorGroups(profile?.coreCount || 12, defaultFiberColorSettings);
  const coreCount = normalizeFiberCoreCount(profile?.coreCount, fiberCoreCountFromGroups(groups) || 12);
  const usesTubes = fiberCoreCountUsesTubes(coreCount);
  if (!usesTubes) {
    const cores = groups[0]?.cores || [];
    return (
      <div className="network-fiber-group-summary network-fiber-core-summary">
        {cores.slice(0, 12).map((core) => (
          <FiberColorSwatch key={core.fiberNumber || core.position} color={core.colorHex} label={core.colorName} />
        ))}
        <span>{coreCount} core color{coreCount === 1 ? '' : 's'}</span>
      </div>
    );
  }
  return (
    <div className="network-fiber-group-summary">
      {groups.slice(0, 4).map((group) => {
        const cores = Array.isArray(group.cores) ? group.cores : [];
        const firstCore = cores[0]?.fiberNumber;
        const lastCore = cores[cores.length - 1]?.fiberNumber;
        const range = firstCore && lastCore ? `F${firstCore}${firstCore === lastCore ? '' : `-F${lastCore}`}` : `${cores.length} cores`;
        return (
          <span className="network-fiber-group-pill" key={group.id || group.groupNumber}>
            <FiberColorSwatch color={group.tubeColorHex} label={group.tubeColorName} />
            {group.tubeColorName || group.groupName} <small>{range}</small>
          </span>
        );
      })}
      {groups.length > 4 && <span className="badge bg-secondary-lt text-secondary">+{groups.length - 4}</span>}
    </div>
  );
}

function FiberColorSettingsEditor({ settings, onChange, onSave, onReset, saving = false }) {
  const normalized = normalizeFiberColorSettings(settings);
  const updatePalette = (paletteKey, index, field, value) => {
    onChange({
      ...normalized,
      [paletteKey]: normalized[paletteKey].map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, [field]: field === 'hex' ? normalizeHexColor(value, entry.hex) : value } : entry
      ))
    });
  };
  const renderPalette = (paletteKey, title) => (
    <div className="network-fiber-palette">
      <div className="network-fiber-palette-title">{title}</div>
      <div className="network-fiber-palette-grid">
        {normalized[paletteKey].map((entry, index) => (
          <div className="network-fiber-palette-row" key={`${paletteKey}-${entry.position}`}>
            <span className="network-fiber-palette-position">{entry.position}</span>
            <input
              className="form-control form-control-color network-fiber-color-input"
              type="color"
              value={entry.hex}
              title={`${title} ${entry.position} color`}
              onChange={(event) => updatePalette(paletteKey, index, 'hex', event.target.value)}
            />
            <input
              className="form-control form-control-sm"
              value={entry.name}
              onChange={(event) => updatePalette(paletteKey, index, 'name', event.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="network-fiber-settings-panel">
      <div className="network-fiber-settings-header">
        <div>
          <h4>Fiber Color Settings</h4>
          <p>Common 12-color order: blue, orange, green, brown, slate, white, red, black, yellow, violet, rose, aqua.</p>
        </div>
        <div className="network-fiber-settings-actions">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onReset}>Reset</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
            <IconDeviceFloppy size={16} className="me-1" />{saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label">Standard / Label</label>
          <input
            className="form-control"
            value={normalized.standardName}
            onChange={(event) => onChange({ ...normalized, standardName: event.target.value })}
          />
        </div>
        <div className="col-md-8">
          <label className="form-label">Notes</label>
          <input
            className="form-control"
            value={normalized.notes}
            onChange={(event) => onChange({ ...normalized, notes: event.target.value })}
          />
        </div>
        <div className="col-lg-6">{renderPalette('fiberColors', 'Fiber Colors')}</div>
        <div className="col-lg-6">{renderPalette('tubeColors', 'Tube / Group Colors')}</div>
      </div>
    </div>
  );
}

function FiberCoreCountChoice({ value, options, onChange }) {
  const numericValue = Number(value) || 12;
  const choices = options.includes(numericValue) ? options : [...options, numericValue].sort((a, b) => a - b);
  return (
    <div className="col-md-4">
      <label className="form-label">Core Count</label>
      <select className="form-select" value={numericValue} onChange={(event) => onChange(Number(event.target.value))}>
        {choices.map((option) => (
          <option key={option} value={option}>{option === 1 ? 'Single Core' : `${option} Core`}</option>
        ))}
      </select>
    </div>
  );
}

function FiberColorSelect({ label, valueName, valueHex, palette, onChange }) {
  const normalizedPalette = normalizeFiberColorPalette(palette, defaultFiberColorEntries);
  const currentKey = `${valueName || ''}|${normalizeHexColor(valueHex, '#64748B')}`;
  const options = normalizedPalette.map((entry) => ({ ...entry, key: `${entry.name}|${entry.hex}` }));
  if (currentKey.trim() !== '|' && !options.some((entry) => entry.key === currentKey)) {
    options.push({ name: valueName || 'Custom', hex: normalizeHexColor(valueHex, '#64748B'), key: currentKey });
  }
  return (
    <label className="network-fiber-color-select">
      <span>{label}</span>
      <div className="network-fiber-color-select-control">
        <FiberColorSwatch color={valueHex} label={valueName} />
        <select
          className="form-select form-select-sm"
          value={currentKey}
          onChange={(event) => {
            const selected = options.find((entry) => entry.key === event.target.value) || options[0];
            onChange({ name: selected.name, hex: selected.hex });
          }}
        >
          {options.map((entry) => (
            <option key={entry.key} value={entry.key}>{entry.name}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

function FiberColorGroupEditor({ groups, settings, onChange }) {
  const normalizedSettings = normalizeFiberColorSettings(settings);
  const normalizedGroups = buildFiberColorGroups(fiberCoreCountFromGroups(groups) || 12, normalizedSettings, groups);
  const coreCount = fiberCoreCountFromGroups(normalizedGroups);
  const usesTubes = fiberCoreCountUsesTubes(coreCount);
  const replaceGroups = (nextGroups) => onChange(buildFiberColorGroups(fiberCoreCountFromGroups(nextGroups) || 1, normalizedSettings, nextGroups));
  const updateGroup = (groupNumber, changes) => {
    replaceGroups(normalizedGroups.map((group) => (group.groupNumber === groupNumber ? { ...group, ...changes } : group)));
  };
  const updateCore = (groupNumber, fiberNumber, color) => {
    replaceGroups(normalizedGroups.map((group) => {
      if (group.groupNumber !== groupNumber) return group;
      return {
        ...group,
        cores: group.cores.map((core) => (
          core.fiberNumber === fiberNumber ? { ...core, colorName: color.name, colorHex: color.hex } : core
        ))
      };
    }));
  };
  const addGroup = () => {
    const nextCoreCount = fiberCoreCountFromGroups(normalizedGroups) + 12;
    onChange(buildFiberColorGroups(nextCoreCount, normalizedSettings, normalizedGroups));
  };
  const removeGroup = (groupNumber) => {
    const nextGroups = normalizedGroups.filter((group) => group.groupNumber !== groupNumber);
    replaceGroups(nextGroups.length ? nextGroups : buildFiberColorGroups(1, normalizedSettings));
  };
  return (
    <div className="col-12">
      <div className="network-ratio-editor-header">
        <h4 className="network-modal-section-title">Fiber Core Color Groups</h4>
        {usesTubes && (
          <button type="button" className="btn btn-primary btn-sm network-header-icon-button" title="Add 12-core color group" aria-label="Add 12-core color group" onClick={addGroup}>
            <IconPlus size={16} />
          </button>
        )}
      </div>
      <div className="network-fiber-group-editor">
        {normalizedGroups.map((group) => (
          <div className="network-fiber-group-card" key={group.id || group.groupNumber}>
            {usesTubes ? (
              <div className="network-fiber-group-card-header">
                <input
                  className="form-control form-control-sm network-fiber-group-name"
                  value={group.groupName}
                  onChange={(event) => updateGroup(group.groupNumber, { groupName: event.target.value })}
                />
                <FiberColorSelect
                  label="Tube"
                  valueName={group.tubeColorName}
                  valueHex={group.tubeColorHex}
                  palette={normalizedSettings.tubeColors}
                  onChange={(color) => updateGroup(group.groupNumber, { tubeColorName: color.name, tubeColorHex: color.hex })}
                />
                {normalizedGroups.length > 1 && (
                  <button type="button" className="btn btn-icon btn-sm" title={`Remove ${group.groupName}`} aria-label={`Remove ${group.groupName}`} onClick={() => removeGroup(group.groupNumber)}>
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div className="network-fiber-single-core-heading">Core Colors</div>
            )}
            <div className="network-fiber-core-grid">
              {group.cores.map((core) => (
                <FiberColorSelect
                  key={core.fiberNumber}
                  label={`F${core.fiberNumber}`}
                  valueName={core.colorName}
                  valueHex={core.colorHex}
                  palette={normalizedSettings.fiberColors}
                  onChange={(color) => updateCore(group.groupNumber, core.fiberNumber, color)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FbtRatioSummary({ rows }) {
  const normalizedRows = compactFbtRatioRows(rows);
  const filledRows = normalizedRows.filter((row) => fbtLossFields.some((field) => row[field]));
  const previewRows = normalizedRows.slice(0, 5);
  return (
    <div className="network-ratio-summary">
      <div className="network-ratio-chip-row">
        {previewRows.map((row) => (
          <span className="badge bg-green-lt text-green" key={row.id || row.ratio}>{formatFbtRatio(row.ratio)}</span>
        ))}
        {normalizedRows.length > previewRows.length && <span className="badge bg-secondary-lt text-secondary">+{normalizedRows.length - previewRows.length}</span>}
      </div>
      <small>{filledRows.length ? `${filledRows.length} ratios with loss values` : 'Loss values not set'}</small>
    </div>
  );
}

function FbtRatioLossPreview({ rows, prefix }) {
  const filledRow = compactFbtRatioRows(rows).find((row) => defaultMeta.wavelengthsNm.some((wavelength) => row[`${prefix}${wavelength}Db`]));
  if (!filledRow) return <span className="text-muted">-</span>;
  return (
    <div className="network-loss-triplet">
      <span><strong>Ratio</strong>{formatFbtRatio(filledRow.ratio)}</span>
      {defaultMeta.wavelengthsNm.map((wavelength) => (
        <span key={wavelength}>
          <strong>{wavelength}</strong>
          {filledRow[`${prefix}${wavelength}Db`] ? `${filledRow[`${prefix}${wavelength}Db`]} dB` : '-'}
        </span>
      ))}
    </div>
  );
}

function FbtRatioRowsEditor({ rows, onChange, visibleWavelengths, onVisibleWavelengthsChange }) {
  const selectedWavelengths = normalizeVisibleWavelengths(visibleWavelengths);
  const lossGroups = [
    { label: 'Connector', prefix: 'connectorLoss' },
    { label: 'Deployment NAP', prefix: 'currentNapLoss' },
    { label: 'Next NAP', prefix: 'nextNapLoss' }
  ];
  const updateRow = (id, field, value) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: field === 'ratio' ? normalizeFbtRatioValue(value) : value } : row)));
  };
  const updateLossGroup = (id, prefix, value) => {
    const parts = splitCombinedLossValue(value);
    onChange(rows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row };
      selectedWavelengths.forEach((wavelength, index) => {
        next[`${prefix}${wavelength}Db`] = parts[index] || '';
      });
      return next;
    }));
  };
  const addCustomRow = () => {
    onChange([
      ...rows,
      makeFbtRatioRow('', { id: `custom-${Date.now()}`, isCustom: true }, true)
    ]);
  };
  const removeCustomRow = (id) => {
    onChange(rows.filter((row) => row.id !== id));
  };
  const toggleWavelength = (wavelength) => {
    const current = new Set(selectedWavelengths);
    if (current.has(wavelength) && current.size > 1) {
      current.delete(wavelength);
    } else {
      current.add(wavelength);
    }
    onVisibleWavelengthsChange(defaultMeta.wavelengthsNm.filter((item) => current.has(item)));
  };
  return (
    <div className="col-12">
      <div className="network-ratio-editor-header">
        <h4 className="network-modal-section-title">FBT Ratios</h4>
        <button type="button" className="btn btn-primary btn-sm network-header-icon-button" title="Add custom ratio" aria-label="Add custom ratio" onClick={addCustomRow}>
          <IconPlus size={16} />
        </button>
      </div>
      <div className="network-wavelength-toggle-row" role="group" aria-label="Visible wavelengths">
        {defaultMeta.wavelengthsNm.map((wavelength) => (
          <label key={wavelength} className="network-wavelength-toggle">
            <input type="checkbox" checked={selectedWavelengths.includes(wavelength)} onChange={() => toggleWavelength(wavelength)} />
            <span>{wavelength} nm</span>
          </label>
        ))}
      </div>
      <div className="table-responsive network-fbt-ratio-editor">
        <table className="table table-vcenter network-table network-fbt-ratio-table">
          <thead>
            <tr>
              <th rowSpan="2" className="network-ratio-heading">Ratio</th>
              {lossGroups.map((group) => (
                <th
                  key={group.prefix}
                  className={`network-ratio-group-heading ${group.prefix === 'connectorLoss' ? 'network-ratio-divider-left' : ''}`}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              {lossGroups.map((group) => (
                <th
                  key={`${group.prefix}-combined`}
                  className={`network-ratio-wavelength-heading ${group.prefix === 'connectorLoss' ? 'network-ratio-divider-left' : ''}`}
                >
                  {selectedWavelengths.join(' / ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="network-ratio-text-cell">
                  <span className="network-ratio-cell-inner">
                    {row.isCustom ? (
                      <>
                        <input
                          className="network-ratio-inline-input"
                          value={row.ratio ? formatFbtRatio(row.ratio) : ''}
                          placeholder="45/55"
                          onChange={(event) => updateRow(row.id, 'ratio', event.target.value)}
                        />
                        <button type="button" className="network-ratio-remove-button" title="Remove custom ratio" aria-label="Remove custom ratio" onClick={() => removeCustomRow(row.id)}>
                          <IconTrash size={14} />
                        </button>
                      </>
                    ) : (
                      <span>{formatFbtRatio(row.ratio)}</span>
                    )}
                  </span>
                </td>
                {lossGroups.map((group) => (
                  <td
                    key={`${group.prefix}-combined`}
                    className={`network-ratio-loss-cell network-ratio-loss-cell-combined ${group.prefix === 'connectorLoss' ? 'network-ratio-divider-left' : ''}`}
                  >
                    <input
                      className="form-control form-control-sm network-ratio-loss-input network-ratio-loss-input-combined"
                      value={combinedFbtLossValue(row, group.prefix, selectedWavelengths)}
                      placeholder={selectedWavelengths.length > 1 ? '0.2, 0.3 / 0.4' : '0.2'}
                      title="Use comma or slash between wavelength values"
                      onChange={(event) => updateLossGroup(row.id, group.prefix, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlcPortLossPreview({ rows }) {
  const normalizedRows = compactSplitterPortLossRows(rows);
  const filledRows = normalizedRows.filter((row) => row.insertionLossDb);
  if (!normalizedRows.length) return <span>Port loss not set</span>;
  return (
    <span>
      {filledRows.length ? `${filledRows.length}/${normalizedRows.length} ports with loss` : `${normalizedRows.length} port losses not set`}
    </span>
  );
}

function PlcRatioSummary({ splitter }) {
  const profiles = normalizeSplitterRatioProfiles(
    splitter?.splitterType,
    splitter?.ratioProfiles,
    splitter?.splitRatio,
    splitter?.portLosses,
    splitter?.insertionLossDb,
    ratioOptionsForSplitterType(splitter?.splitterType, defaultMeta)
  );
  const previewProfiles = profiles.slice(0, 4);
  const filledProfiles = profiles.filter((profile) => compactSplitterPortLossRows(profile.portLosses).some((row) => row.insertionLossDb));
  return (
    <div className="network-ratio-summary">
      <div className="network-ratio-chip-row">
        {previewProfiles.map((profile) => (
          <span className="badge bg-blue-lt text-blue" key={profile.id || profile.splitRatio}>{formatSplitterRatio(profile.splitRatio)}</span>
        ))}
        {profiles.length > previewProfiles.length && <span className="badge bg-secondary-lt text-secondary">+{profiles.length - previewProfiles.length}</span>}
      </div>
      <small>{filledProfiles.length ? `${filledProfiles.length} ratios with port loss` : 'Port loss not set'}</small>
    </div>
  );
}

function PlcPortLossEditor({ rows, onChange }) {
  const updatePortLoss = (portNumber, value) => {
    onChange(rows.map((row) => (
      row.portNumber === portNumber ? { ...row, insertionLossDb: value } : row
    )));
  };
  return (
    <div className="col-12">
      <div className="network-ratio-editor-header">
        <h4 className="network-modal-section-title">Port Insertion Loss</h4>
      </div>
      <div className="table-responsive network-plc-port-loss-editor">
        <table className="table table-vcenter network-table network-plc-port-loss-table">
          <thead>
            <tr>
              {rows.map((row) => (
                <th key={`port-heading-${row.portNumber}`}>Port {row.portNumber}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows.map((row) => (
                <td key={`port-loss-${row.portNumber}`}>
                  <input
                    className="form-control form-control-sm network-plc-port-loss-input"
                    value={row.insertionLossDb || ''}
                    placeholder="dB"
                    onChange={(event) => updatePortLoss(row.portNumber, event.target.value)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlcRatioProfilesEditor({ splitterType, profiles, options, onChange }) {
  const normalizedProfiles = normalizeSplitterRatioProfiles(splitterType, profiles, options[0], [], '', options);
  const profilesByRatio = new Map(normalizedProfiles.map((profile) => [profile.splitRatio, profile]));
  const selectedRatios = new Set(normalizedProfiles.map((profile) => profile.splitRatio));
  const replaceProfiles = (nextProfiles) => onChange(normalizeSplitterRatioProfiles(splitterType, nextProfiles, nextProfiles[0]?.splitRatio || options[0], [], '', options));
  const toggleRatio = (ratio) => {
    const normalizedRatio = normalizeSplitterRatioValue(ratio);
    if (selectedRatios.has(normalizedRatio)) {
      if (selectedRatios.size === 1) return;
      replaceProfiles(normalizedProfiles.filter((profile) => profile.splitRatio !== normalizedRatio));
      return;
    }
    replaceProfiles([
      ...normalizedProfiles,
      {
        id: `ratio-${normalizedRatio.replace(':', '-')}`,
        splitRatio: normalizedRatio,
        ratio: normalizedRatio,
        outputPorts: splitterOutputPortsFromRatio(normalizedRatio, 1),
        portLosses: makeSplitterPortLossRows(normalizedRatio)
      }
    ]);
  };
  const updateProfileLosses = (ratio, portLosses) => {
    replaceProfiles(normalizedProfiles.map((profile) => (
      profile.splitRatio === ratio ? { ...profile, portLosses } : profile
    )));
  };
  return (
    <div className="col-12">
      <div className="network-ratio-editor-header">
        <h4 className="network-modal-section-title">{splitterType} Ratios</h4>
      </div>
      <div className="network-wavelength-toggle-row" role="group" aria-label={`${splitterType} ratios`}>
        {options.map((ratio) => {
          const normalizedRatio = normalizeSplitterRatioValue(ratio);
          return (
            <label key={ratio} className="network-wavelength-toggle">
              <input type="checkbox" checked={selectedRatios.has(normalizedRatio)} onChange={() => toggleRatio(ratio)} />
              <span>{formatSplitterRatio(ratio)}</span>
            </label>
          );
        })}
      </div>
      <div className="network-plc-profile-stack">
        {normalizedProfiles.map((profile) => (
          <div className="network-plc-profile-card" key={profile.id || profile.splitRatio}>
            <div className="network-plc-profile-title">{formatSplitterRatio(profile.splitRatio)}</div>
            <PlcPortLossEditor
              rows={profilesByRatio.get(profile.splitRatio)?.portLosses || profile.portLosses}
              onChange={(portLosses) => updateProfileLosses(profile.splitRatio, portLosses)}
            />
          </div>
        ))}
      </div>
    </div>
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

function SplitterManufacturerInput({ value, options, adding, onSelect, onAddNew, onChange }) {
  if (!adding) {
    return (
      <SelectInput
        label="Manufacturer / Company"
        required
        value={value}
        onChange={(nextValue) => {
          if (nextValue === ADD_SPLITTER_MANUFACTURER_VALUE) {
            onAddNew();
            return;
          }
          onSelect(nextValue);
        }}
      >
        <option value="" disabled>Select manufacturer</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
        <option value={ADD_SPLITTER_MANUFACTURER_VALUE}>+ Add new manufacturer</option>
      </SelectInput>
    );
  }
  return (
    <TextInput
      label="Manufacturer / Company"
      required
      placeholder="Enter manufacturer / company"
      value={value}
      onChange={onChange}
    />
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

function CrudModal({ title, icon: Icon, children, onClose, onSubmit, submitDisabled = false, submitLabel = 'Save', modalClassName = '' }) {
  return (
    <div className="network-modal-backdrop" role="presentation">
      <div className={`network-modal ${modalClassName}`} role="dialog" aria-modal="true" aria-labelledby="network-modal-title">
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
  const [fiberOptics, setFiberOptics] = useState([]);
  const [fiberMapping, setFiberMapping] = useState(blankFiberMapping);
  const [fiberMappingSaving, setFiberMappingSaving] = useState(false);
  const [fiberMappingNapMenuPonId, setFiberMappingNapMenuPonId] = useState('');
  const [fiberMappingTreeMenuPlacement, setFiberMappingTreeMenuPlacement] = useState(null);
  const [fiberMappingView, setFiberMappingView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [fiberMappingPanning, setFiberMappingPanning] = useState(false);
  const [fiberMappingCtrlPressed, setFiberMappingCtrlPressed] = useState(false);
  const [fiberMappingSelectionBox, setFiberMappingSelectionBox] = useState(null);
  const [fiberMappingSelectedNodeKeys, setFiberMappingSelectedNodeKeys] = useState([]);
  const [fiberMappingSelectedEdgeId, setFiberMappingSelectedEdgeId] = useState('');
  const [fiberLinkCanvasPonId, setFiberLinkCanvasPonId] = useState('');
  const [fiberLinkCanvasView, setFiberLinkCanvasView] = useState({ zoom: 1, panX: 32, panY: 32, panning: false });
  const [fiberLineReturnPonId, setFiberLineReturnPonId] = useState('');
  const [fiberLinkSettingsForm, setFiberLinkSettingsForm] = useState(defaultFiberLinkSettings);
  const [fiberLinkSettingsError, setFiberLinkSettingsError] = useState('');
  const [fiberLinkSettingsReturnPonId, setFiberLinkSettingsReturnPonId] = useState('');
  const [fiberLineForm, setFiberLineForm] = useState(() => defaultFiberEdgeConfig());
  const [fiberLineFormError, setFiberLineFormError] = useState('');
  const [fiberMappingSelectedSplitterKey, setFiberMappingSelectedSplitterKey] = useState('');
  const [fiberMappingLayoutContainerKey, setFiberMappingLayoutContainerKey] = useState('');
  const [fiberLayoutReturnPonId, setFiberLayoutReturnPonId] = useState('');
  const [fiberLayoutIncomingEdgeId, setFiberLayoutIncomingEdgeId] = useState('');
  const [fiberDeleteTarget, setFiberDeleteTarget] = useState(null);
  const [fiberMappingSpawnedSplitterKey, setFiberMappingSpawnedSplitterKey] = useState('');
  const [fiberMappingUndoDepth, setFiberMappingUndoDepth] = useState(0);
  const [fiberMappingExpandedContainerKeys, setFiberMappingExpandedContainerKeys] = useState([]);
  const [fiberSplitterAddDraft, setFiberSplitterAddDraft] = useState(null);
  const [fiberLayoutModalView, setFiberLayoutModalView] = useState({ zoom: 1, panX: 32, panY: 32, panning: false });
  const [fiberColorSettings, setFiberColorSettings] = useState(defaultFiberColorSettings);
  const [fiberColorDraft, setFiberColorDraft] = useState(defaultFiberColorSettings);
  const [fiberSettingsSaving, setFiberSettingsSaving] = useState(false);
  const [onus, setOnus] = useState([]);
  const [devices, setDevices] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mapImages, setMapImages] = useState(null);
  const [mapProviderSettings, setMapProviderSettings] = useState(normalizeMapProviderSettings());
  const [mapProviderSession, setMapProviderSession] = useState(null);
  const [mapProviderSessionError, setMapProviderSessionError] = useState('');
  const [customerProfiles, setCustomerProfiles] = useState([]);
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
  const [splitterTab, setSplitterTab] = useState('FBT');
  const [fiberOpticTab, setFiberOpticTab] = useState('list');
  const [expandedNapOltIds, setExpandedNapOltIds] = useState({});
  const [expandedNapPonIds, setExpandedNapPonIds] = useState({});
  const [mapOltFilter, setMapOltFilter] = useState('');
  const [mapTypeFilter, setMapTypeFilter] = useState('');
  const mapPreferencesRef = useRef(null);
  if (!mapPreferencesRef.current) mapPreferencesRef.current = readMapPreferences();
  const [mapView, setMapView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [mapTileMode, setMapTileMode] = useState(mapPreferencesRef.current.providerId);
  const [mapHighDetail, setMapHighDetail] = useState(mapPreferencesRef.current.highDetail);
  const [mapLayerVisibility, setMapLayerVisibility] = useState(mapPreferencesRef.current.layerVisibility);
  const [mapSurfaceSize, setMapSurfaceSize] = useState(DEFAULT_MAP_SURFACE);
  const [mapDragging, setMapDragging] = useState(false);
  const [mapEditMode, setMapEditMode] = useState(false);
  const [mapMarkerDraft, setMapMarkerDraft] = useState(null);
  const [mapSavingMarkerId, setMapSavingMarkerId] = useState('');
  const [mapMarkerSaveError, setMapMarkerSaveError] = useState('');
  const [mapFocusedNodeId, setMapFocusedNodeId] = useState('');
  const [mapSelectedLineId, setMapSelectedLineId] = useState('');
  const [mapLineEditMode, setMapLineEditMode] = useState(false);
  const [mapHideOtherLines, setMapHideOtherLines] = useState(false);
  const [mapLinePopover, setMapLinePopover] = useState(null);
  const [mapSavingLineId, setMapSavingLineId] = useState('');
  const [mapLineMessage, setMapLineMessage] = useState('');
  const [serviceabilitySearch, setServiceabilitySearch] = useState('');
  const [serviceabilityStatusFilter, setServiceabilityStatusFilter] = useState('');
  const [serviceabilityCustomerId, setServiceabilityCustomerId] = useState('');
  const [serviceabilityHouse, setServiceabilityHouse] = useState({ latitude: '', longitude: '' });
  const [serviceabilitySelectedNapId, setServiceabilitySelectedNapId] = useState('');
  const [serviceabilityNapDetailId, setServiceabilityNapDetailId] = useState('');
  const [serviceabilityMapMenuOpen, setServiceabilityMapMenuOpen] = useState(false);
  const [serviceabilityView, setServiceabilityView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [serviceabilitySurfaceSize, setServiceabilitySurfaceSize] = useState(DEFAULT_MAP_SURFACE);
  const [serviceabilityDragging, setServiceabilityDragging] = useState(false);
  const [serviceabilityLoadedTileIds, setServiceabilityLoadedTileIds] = useState({});
  const [serviceabilityReadyTiles, setServiceabilityReadyTiles] = useState([]);
  const mapDragRef = useRef(null);
  const mapMarkerDragRef = useRef(null);
  const mapMarkerDraftRef = useRef(null);
  const mapLineBendDragRef = useRef(null);
  const mapLinePopoverDragRef = useRef(null);
  const mapSurfaceRef = useRef(null);
  const serviceabilitySurfaceRef = useRef(null);
  const serviceabilityDragRef = useRef(null);
  const serviceabilityReadyTileSignatureRef = useRef('');
  const serviceabilityRouteCustomerRef = useRef('');
  const fiberMappingDragRef = useRef(null);
  const fiberMappingInternalSplitterDragRef = useRef(null);
  const fiberMappingInternalConnectionDragRef = useRef(null);
  const fiberMappingInternalSuppressClickRef = useRef({ connection: false, splitter: false });
  const fiberMappingNodeSuppressClickRef = useRef(false);
  const fiberMappingPanRef = useRef(null);
  const fiberMappingSelectionRef = useRef(null);
  const fiberMappingSurfaceRef = useRef(null);
  const fiberLayoutModalPanRef = useRef(null);
  const fiberLayoutModalSurfaceRef = useRef(null);
  const fiberLinkCanvasPanRef = useRef(null);
  const fiberMappingRef = useRef(blankFiberMapping);
  const fiberMappingSelectedSplitterKeyRef = useRef('');
  const fiberMappingUndoStackRef = useRef([]);
  const [modalType, setModalType] = useState('');
  const [oltForm, setOltForm] = useState(blankOlt);
  const [ponForm, setPonForm] = useState(blankPon);
  const [ponPowerOlt, setPonPowerOlt] = useState(null);
  const [ponColorSavingId, setPonColorSavingId] = useState('');
  const [napForm, setNapForm] = useState(blankNap);
  const [napSelectedOltId, setNapSelectedOltId] = useState('');
  const [napAddAnother, setNapAddAnother] = useState(false);
  const [napFormError, setNapFormError] = useState('');
  const [napSaving, setNapSaving] = useState(false);
  const [fbtForm, setFbtForm] = useState(blankFbt);
  const [splitterManufacturerAdding, setSplitterManufacturerAdding] = useState(false);
  const [fiberOpticForm, setFiberOpticForm] = useState(blankFiberOptic);
  const [fiberOpticFormError, setFiberOpticFormError] = useState('');
  const [deviceForm, setDeviceForm] = useState(blankDevice);
  const [deviceFormError, setDeviceFormError] = useState('');
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [deviceOrderDraggingId, setDeviceOrderDraggingId] = useState('');
  const [deviceOrderSaving, setDeviceOrderSaving] = useState(false);
  const [deviceOrderError, setDeviceOrderError] = useState('');
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
  const mapProviderOptions = useMemo(
    () => enabledMapProviders(mapProviderSettings),
    [mapProviderSettings]
  );
  const selectedMapProvider = useMemo(
    () => mapProviderById(mapProviderSettings, mapTileMode) || defaultMapProvider(mapProviderSettings),
    [mapProviderSettings, mapTileMode]
  );
  const activeMapProviderId = selectedMapProvider?.id || '';
  const activeTileProvider = useMemo(
    () => mapProviderWithSession(selectedMapProvider, mapProviderSession),
    [selectedMapProvider, mapProviderSession]
  );

  useEffect(() => {
    if (!mapProviderOptions.length) return;
    if (mapProviderOptions.some((provider) => provider.id === mapTileMode)) return;
    setMapTileMode(selectedMapProvider?.id || mapProviderOptions[0].id);
  }, [mapProviderOptions, mapTileMode, selectedMapProvider]);

  useEffect(() => {
    let cancelled = false;
    setMapProviderSession(null);
    setMapProviderSessionError('');
    if (!mapProviderNeedsSession(selectedMapProvider)) return undefined;
    createMapProviderSession(selectedMapProvider)
      .then((session) => {
        if (!cancelled) setMapProviderSession(session);
      })
      .catch((err) => {
        if (!cancelled) setMapProviderSessionError(err.message || 'Map provider session failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedMapProvider?.id,
    selectedMapProvider?.apiKey,
    selectedMapProvider?.sessionProvider,
    selectedMapProvider?.googleMapType,
    selectedMapProvider?.googleLanguage,
    selectedMapProvider?.googleRegion
  ]);

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
    setSplitterTab('FBT');
    setFiberOpticTab('list');
    setFiberMappingNapMenuPonId('');
    setFiberMappingSelectedEdgeId('');
    setFiberLineForm(defaultFiberEdgeConfig());
    setFiberLineFormError('');
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingLayoutContainerKey('');
    setFiberMappingSpawnedSplitterKey('');
    setFiberMappingExpandedContainerKeys([]);
    setFiberSplitterAddDraft(null);
    setMapOltFilter('');
    setMapTypeFilter('');
    setMapMarkerDraft(null);
    setMapMarkerSaveError('');
    setMapFocusedNodeId('');
    setMapSelectedLineId('');
    setMapLineEditMode(false);
    setMapHideOtherLines(false);
    setMapLinePopover(null);
    setMapLineMessage('');
    mapLinePopoverDragRef.current = null;
    setServiceabilitySearch('');
    setServiceabilityStatusFilter('');
    setServiceabilityCustomerId('');
    serviceabilityRouteCustomerRef.current = '';
    setServiceabilityHouse({ latitude: '', longitude: '' });
    setServiceabilitySelectedNapId('');
    setServiceabilityNapDetailId('');
    setServiceabilityMapMenuOpen(false);
    setServiceabilityDragging(false);
    serviceabilityDragRef.current = null;
    setPppoeStatusFilter('');
    setPppoeRouterFilter('');
    setPppoeProfileFilter('');
    setPppoePage(1);
  }, [initialSection]);

  useEffect(() => {
    if (activeSection !== 'serviceability') return;
    const params = new URLSearchParams(window.location.search);
    const routeCustomerId = params.get('customerId') || params.get('customer') || '';
    if (!routeCustomerId || serviceabilityRouteCustomerRef.current === routeCustomerId) return;
    if (!customerProfiles.some((customer) => customer.id === routeCustomerId)) return;
    serviceabilityRouteCustomerRef.current = routeCustomerId;
    setServiceabilitySearch('');
    setServiceabilityStatusFilter('');
    selectServiceabilityCustomer(routeCustomerId);
  }, [activeSection, customerProfiles]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => {
      setMessage((current) => (current === message ? '' : current));
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    fiberMappingRef.current = fiberMapping;
  }, [fiberMapping]);

  useEffect(() => {
    mapMarkerDraftRef.current = mapMarkerDraft;
  }, [mapMarkerDraft]);

  useEffect(() => {
    writeMapPreferences({
      providerId: activeMapProviderId || mapTileMode,
      highDetail: mapHighDetail,
      layerVisibility: mapLayerVisibility
    });
  }, [activeMapProviderId, mapTileMode, mapHighDetail, mapLayerVisibility]);

  useEffect(() => {
    serviceabilityReadyTileSignatureRef.current = '';
    setServiceabilityReadyTiles([]);
    setServiceabilityLoadedTileIds({});
  }, [activeMapProviderId, mapProviderSession?.session]);

  useEffect(() => {
    if (mapEditMode) return;
    mapMarkerDragRef.current = null;
    setMapMarkerDraft(null);
    setMapMarkerSaveError('');
  }, [mapEditMode]);

  useEffect(() => {
    fiberMappingSelectedSplitterKeyRef.current = fiberMappingSelectedSplitterKey;
  }, [fiberMappingSelectedSplitterKey]);

  useEffect(() => {
    if (activeSection !== 'fiber-mapping') return undefined;
    const isTextEntry = (target) => {
      const tag = String(target?.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    };
    const onKeyDown = (event) => {
      if (event.key === 'Control') setFiberMappingCtrlPressed(true);
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'z' && !event.shiftKey && !isTextEntry(event.target)) {
        event.preventDefault();
        performFiberMappingUndo();
      }
      if ((event.key === 'Delete' || event.key === 'Del' || event.key === 'Backspace') && !isTextEntry(event.target)) {
        event.preventDefault();
        const selectedSplitterKey = fiberMappingSelectedSplitterKeyRef.current;
        if (selectedSplitterKey) deleteSelectedFiberMappingSplitter(selectedSplitterKey);
        else deleteSelectedFiberMappingObjects();
      }
    };
    const onKeyUp = (event) => {
      if (event.key === 'Control') setFiberMappingCtrlPressed(false);
    };
    const onBlur = () => setFiberMappingCtrlPressed(false);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [activeSection, fiberMappingSaving, fiberMappingSelectedNodeKeys, fiberMappingSelectedSplitterKey, fiberMapping]);

  useEffect(() => {
    if (activeSection !== 'fiber-mapping') return undefined;
    const surface = fiberMappingSurfaceRef.current;
    if (!surface) return undefined;
    surface.addEventListener('wheel', wheelFiberMapping, { passive: false });
    return () => surface.removeEventListener('wheel', wheelFiberMapping);
  });

  async function load() {
    setError('');
    try {
      const [nextMeta, nextOverview, nextOlts, nextPons, nextNaps, nextFbts, nextFiberOptics, nextFiberSettings, nextFiberMapping, nextOnus, nextDevices, nextMapImages, nextMapProviders, nextCustomers] = await Promise.all([
        request('/network-settings/meta'),
        request('/network-settings/overview'),
        request('/network-settings/olts'),
        request('/network-settings/pons'),
        request('/network-settings/nap-boxes'),
        request('/network-settings/fbts'),
        request('/network-settings/fiber-optic-losses'),
        request('/network-settings/fiber-optic-settings'),
        request('/network-settings/fiber-mapping'),
        request('/network-settings/onus'),
        request('/network-settings/devices'),
        request('/system-settings/map-images').catch(() => null),
        request('/system-settings/map-providers').catch(() => null),
        loadServiceabilityCustomerProfiles().catch(() => [])
      ]);
      const normalizedFiberSettings = normalizeFiberColorSettings(nextFiberSettings?.colorSettings || nextMeta.fiberColorSettings);
      const orderedOlts = [...nextOlts].sort(sortByDisplayOrder);
      const orderedDevices = [...nextDevices].sort(sortNetworkDeviceRows);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setOlts(orderedOlts);
      setPons(nextPons);
      setNaps(uniqueNapRows(nextNaps));
      setFbts(nextFbts);
      setFiberOptics(nextFiberOptics);
      setFiberMapping(repairFiberMappingEndpointRoles(
        nextFiberMapping,
        new Map(nextFbts.map((splitter) => [splitter.id, splitter]))
      ));
      setFiberColorSettings(normalizedFiberSettings);
      setFiberColorDraft(normalizedFiberSettings);
      setOnus(nextOnus);
      setDevices(orderedDevices);
      if (nextMapImages) setMapImages(nextMapImages);
      setMapProviderSettings(normalizeMapProviderSettings(nextMapProviders || undefined));
      setCustomerProfiles(Array.isArray(nextCustomers) ? nextCustomers : []);
      setSelectedOltId((current) => (current && orderedOlts.some((olt) => olt.id === current) ? current : orderedOlts[0]?.id || ''));
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
    if (activeSection !== 'serviceability') return undefined;
    const node = serviceabilitySurfaceRef.current;
    if (!node) return undefined;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || DEFAULT_MAP_SURFACE.width));
      const height = Math.max(320, Math.round(rect.height || DEFAULT_MAP_SURFACE.height));
      setServiceabilitySurfaceSize((current) => {
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
  }, [activeSection, serviceabilityCustomerId]);

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
  const filteredFiberOptics = useMemo(() => fiberOptics.filter((fiber) => matches(fiber, search)), [fiberOptics, search]);
  const splitterCounts = useMemo(() => (
    (meta.splitterTypes || defaultMeta.splitterTypes).reduce((counts, type) => ({
      ...counts,
      [type]: fbts.filter((splitter) => normalizeSplitterType(splitter.splitterType) === type).length
    }), {})
  ), [fbts, meta.splitterTypes]);
  const activeSplitters = useMemo(
    () => filteredFbts.filter((splitter) => normalizeSplitterType(splitter.splitterType) === splitterTab),
    [filteredFbts, splitterTab]
  );
  const splitterManufacturersByType = useMemo(() => {
    const groups = {};
    fbts.forEach((splitter) => {
      const type = normalizeSplitterType(splitter.splitterType);
      const manufacturer = String(splitter.manufacturer || splitter.brand || '').trim();
      if (!manufacturer) return;
      const currentGroup = groups[type] || [];
      if (!currentGroup.some((entry) => entry.toLowerCase() === manufacturer.toLowerCase())) {
        currentGroup.push(manufacturer);
      }
      groups[type] = currentGroup;
    });
    Object.keys(groups).forEach((type) => {
      groups[type] = [...groups[type]].sort((a, b) => a.localeCompare(b));
    });
    return groups;
  }, [fbts]);
  const ponsById = useMemo(() => new Map(pons.map((pon) => [pon.id, pon])), [pons]);
  const napsById = useMemo(() => new Map(naps.map((nap) => [nap.id, nap])), [naps]);
  const splittersById = useMemo(() => new Map(fbts.map((splitter) => [splitter.id, splitter])), [fbts]);
  const serviceabilityNapTopologyById = useMemo(() => {
    const mapping = normalizeFiberMapping(fiberMapping);
    return new Map(uniqueNapRows(naps).map((nap) => [
      nap.id,
      serviceabilityTopologyForNap(nap.id, mapping, splittersById)
    ]));
  }, [fiberMapping, naps, splittersById]);
  const serviceabilityNapCandidates = useMemo(() => uniqueNapRows(naps)
    .filter(hasCoordinates)
    .map((nap) => {
      const topology = serviceabilityNapTopologyById.get(nap.id) || serviceabilityTopologyForNap(nap.id, normalizeFiberMapping(fiberMapping), splittersById);
      const coordinates = rowCoordinates(nap);
      const capacity = topology.topologyCapacity || napServiceCapacity(nap);
      const usedPorts = napUsedServicePorts(nap);
      const remainingPorts = Math.max(0, capacity - usedPorts);
      const serviceable = remainingPorts > 0 && !['FULL', 'OFFLINE', 'ARCHIVED'].includes(String(nap.status || '').toUpperCase());
      return {
        id: `nap-${nap.id}`,
        sourceId: nap.id,
        type: 'nap',
        label: nap.name,
        detail: [nap.oltName, nap.ponLabel, nap.barangay].filter(Boolean).join(' / ') || 'NAP Box',
        status: nap.status,
        capacity,
        usedPorts,
        remainingPorts,
        serviceable,
        coordinates,
        topology,
        ponColorHex: normalizeHexColor(ponsById.get(nap.ponPortId) ? ponColor(ponsById.get(nap.ponPortId), meta.ponColorPalette) : nap.ponColorHex, PON_COLOR_BASES[0]),
        sourceNap: nap
      };
    }), [naps, ponsById, meta.ponColorPalette, serviceabilityNapTopologyById, fiberMapping, splittersById]);
  const serviceabilityAllCustomerRows = useMemo(() => customerProfiles.map((customer) => {
    const coordinates = rowCoordinates(customer);
    const customerMapping = serviceabilityCustomerMapping(customer);
    const mappedNap = serviceabilityCandidateForMappedCustomer(customer, serviceabilityNapCandidates);
    const mappedNapRecord = customerMapping.napId ? napsById.get(customerMapping.napId) : null;
    const mappedNapExists = Boolean(mappedNap || mappedNapRecord);
    const locationCandidates = serviceabilityCandidatesForSelectedCustomer(customer, serviceabilityNapCandidates);
    const candidates = coordinates
      ? locationCandidates
        .map((nap) => ({
          ...nap,
          customerMapped: sameServiceabilityId(nap.sourceId, customerMapping.napId),
          mappedPortNumber: sameServiceabilityId(nap.sourceId, customerMapping.napId) ? customerMapping.portNumber : 0,
          mappedSplitterId: customerMapping.splitterId,
          mappedSplitterAssignmentId: customerMapping.assignmentId,
          distanceMeters: haversineMeters(coordinates, nap.coordinates)
        }))
        .filter((nap) => Number.isFinite(nap.distanceMeters))
        .sort((left, right) => left.distanceMeters - right.distanceMeters)
      : mappedNap
        ? [{
          ...mappedNap,
          customerMapped: true,
          mappedPortNumber: customerMapping.portNumber,
          mappedSplitterId: customerMapping.splitterId,
          mappedSplitterAssignmentId: customerMapping.assignmentId,
          distanceMeters: null
        }]
      : [];
    const recommendedNap = mappedNapExists
      ? candidates.find((nap) => sameServiceabilityId(nap.sourceId, mappedNap?.sourceId || mappedNapRecord?.id)) || {
        ...(mappedNap || {}),
        sourceId: mappedNap?.sourceId || mappedNapRecord?.id || customerMapping.napId,
        label: mappedNap?.label || mappedNapRecord?.name || 'Mapped NAP',
        detail: mappedNap?.detail || [mappedNapRecord?.oltName, mappedNapRecord?.ponLabel, mappedNapRecord?.barangay].filter(Boolean).join(' / '),
        customerMapped: true,
        mappedPortNumber: customerMapping.portNumber
      }
      : candidates.find((nap) => nap.serviceable) || candidates[0] || null;
    const status = mappedNapExists
      ? 'MAPPED'
      : !coordinates
      ? 'NEEDS_COORDINATES'
      : !locationCandidates.length
        ? 'NO_NAP'
        : recommendedNap?.serviceable
          ? 'SERVICEABLE'
          : 'NO_PORTS';
    return {
      id: customer.id,
      customer,
      coordinates,
      status,
      statusMeta: serviceabilityStatusMeta(status),
      customerMapping,
      recommendedNap
    };
  }), [customerProfiles, serviceabilityNapCandidates, napsById]);
  const serviceabilityCustomerRows = useMemo(() => {
    const searchTerm = String(serviceabilitySearch || '').trim().toLowerCase();
    return serviceabilityAllCustomerRows.filter((row) => {
      if (serviceabilityStatusFilter && row.status !== serviceabilityStatusFilter) return false;
      if (!searchTerm) return true;
      return [
        customerDisplayName(row.customer),
        row.customer.accountNumber,
        row.customer.contactNumber,
        customerServiceAddress(row.customer),
        row.customer.locationName,
        row.customer.barangay,
        row.statusMeta.label,
        row.customerMapping?.napId,
        row.customerMapping?.portNumber,
        row.recommendedNap?.label,
        row.recommendedNap?.detail
      ].filter(Boolean).join(' ').toLowerCase().includes(searchTerm);
    });
  }, [serviceabilityAllCustomerRows, serviceabilitySearch, serviceabilityStatusFilter]);
  const selectedServiceabilityCustomer = useMemo(
    () => customerProfiles.find((customer) => customer.id === serviceabilityCustomerId) || null,
    [customerProfiles, serviceabilityCustomerId]
  );
  const selectedServiceabilityNapCandidates = useMemo(
    () => serviceabilityCandidatesForSelectedCustomer(selectedServiceabilityCustomer, serviceabilityNapCandidates),
    [selectedServiceabilityCustomer, serviceabilityNapCandidates]
  );
  const fiberMappingCanvas = useMemo(() => {
    const mapping = normalizeFiberMapping(fiberMapping);
    const nodes = [];
    const edges = [];
    const mappedNapIds = new Set(
      Object.keys(mapping.nodes || {})
        .filter((key) => key.startsWith('nap:'))
        .map((key) => key.slice(4))
        .filter((napId) => napsById.has(napId))
    );
    let maxX = FIBER_MAPPING_CANVAS.width;
    let maxY = 260;
    let layoutY = FIBER_MAPPING_GROUP_TOP;
    const nodeFromStored = (key, fallback, size, extra = {}) => {
      const stored = mapping.nodes[key] || {};
      const storedX = asNumber(stored.x, fallback.x);
      const xLimit = Math.max(FIBER_MAPPING_CANVAS.width, fallback.x + size.width + 600, storedX + size.width + 220);
      const x = clamp(storedX, 20, xLimit - size.width - 20);
      const yLimit = Math.max(FIBER_MAPPING_CANVAS.height, fallback.y + size.height + FIBER_MAPPING_OLT_GAP);
      const y = clamp(asNumber(stored.y, fallback.y), 20, yLimit - size.height - 20);
      maxX = Math.max(maxX, x + size.width + 180);
      maxY = Math.max(maxY, y + size.height + 120);
      return {
        key,
        x,
        y,
        width: size.width,
        height: size.height,
        locked: Boolean(stored.locked),
        visible: stored.visible !== false,
        ...extra
      };
    };

    olts.forEach((olt) => {
      const oltKey = fiberMapNodeKey('olt', olt.id);
      const oltPons = pons
        .filter((pon) => pon.oltId === olt.id)
        .sort((left, right) => Number(left.portNumber || 0) - Number(right.portNumber || 0));
      const ponColumnHeight = oltPons.length
        ? ((oltPons.length - 1) * FIBER_MAPPING_PON_SPACING) + FIBER_MAPPING_NODE_SIZE.pon.height
        : FIBER_MAPPING_NODE_SIZE.pon.height;
      const groupHeight = Math.max(FIBER_MAPPING_NODE_SIZE.olt.height, ponColumnHeight);
      const oltY = layoutY + Math.max(0, (groupHeight - FIBER_MAPPING_NODE_SIZE.olt.height) / 2);
      const ponColumnTop = layoutY + Math.max(0, (groupHeight - ponColumnHeight) / 2);
      const oltNode = nodeFromStored(
        oltKey,
        { x: 90, y: oltY },
        FIBER_MAPPING_NODE_SIZE.olt,
        {
          type: 'olt',
          source: olt,
          label: olt.name,
          detail: [olt.vendor, olt.model || olt.managementIp].filter(Boolean).join(' / ') || 'OLT',
          status: olt.status
        }
      );
      nodes.push(oltNode);
      oltPons.forEach((pon, ponIndex) => {
        const ponKey = fiberMapNodeKey('pon', pon.id);
        const ponY = ponColumnTop + ponIndex * FIBER_MAPPING_PON_SPACING;
        const ponNode = nodeFromStored(
          ponKey,
          { x: oltNode.x + 330, y: Math.max(40, ponY) },
          FIBER_MAPPING_NODE_SIZE.pon,
          {
            type: 'pon',
            source: pon,
            label: canonicalPonLabel(pon),
            detail: [titleize(pon.technology), formatDbm(pon.moduleRxPowerDbm)].filter(Boolean).join(' / '),
            status: pon.operationalStatus,
            oltId: olt.id,
            ponId: pon.id,
            napCount: naps.filter((nap) => nap.ponPortId === pon.id).length
          }
        );
        nodes.push(ponNode);
        edges.push({
          id: fiberMapEdgeKey(oltKey, ponKey),
          type: 'olt-pon',
          fromKey: oltKey,
          toKey: ponKey,
          oltId: olt.id,
          ponId: pon.id,
          label: `${olt.name} / ${canonicalPonLabel(pon)}`
        });
        const mappedNaps = naps
          .filter((nap) => nap.ponPortId === pon.id && mappedNapIds.has(nap.id))
          .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        mappedNaps.forEach((nap, napIndex) => {
          const napKey = fiberMapNodeKey('nap', nap.id);
          const storedNap = mapping.nodes?.[napKey] || {};
          const napSourceKey = storedNap.sourceKey && storedNap.sourceKey !== napKey ? storedNap.sourceKey : ponKey;
          const napNode = nodeFromStored(
            napKey,
            { x: ponNode.x + 310, y: ponNode.y + napIndex * 172 - Math.max(0, mappedNaps.length - 1) * 70 },
            FIBER_MAPPING_NODE_SIZE.nap,
            {
              type: 'nap',
              source: nap,
              label: nap.name,
              detail: [canonicalPonLabel(pon), nap.barangay].filter(Boolean).join(' / ') || 'NAP Box',
              status: nap.status,
              oltId: olt.id,
              ponId: pon.id,
              sourceKey: napSourceKey,
              splitterIds: mapping.containerSplitters?.[napKey] || mapping.napSplitters?.[nap.id] || [],
              splitterAssignments: mapping.containerSplitterAssignments?.[napKey] || [],
              connectionPoints: mapping.connectionPoints || {}
            }
          );
          nodes.push(napNode);
          const sourceType = napSourceKey.split(':')[0] || 'pon';
          edges.push({
            id: fiberMapEdgeKey(napSourceKey, napKey),
            type: sourceType === 'pon' ? 'pon-nap' : `${sourceType}-nap`,
            fromKey: napSourceKey,
            toKey: napKey,
            oltId: olt.id,
            ponId: pon.id,
            napId: nap.id,
            fallbackFromKey: ponKey,
            splitterIds: mapping.containerSplitters?.[napKey] || mapping.napSplitters?.[nap.id] || [],
            splitterAssignments: mapping.containerSplitterAssignments?.[napKey] || [],
            label: `${canonicalPonLabel(pon)} / ${nap.name}`
          });
        });
      });
      layoutY += groupHeight + FIBER_MAPPING_OLT_GAP;
    });

    const baseNodeMap = new Map(nodes.map((node) => [node.key, node]));
    Object.values(mapping.junctionBoxes || {})
      .filter((junction) => junction?.id && junction?.sourceKey)
      .sort((left, right) => String(left.createdAt || left.name || left.id).localeCompare(String(right.createdAt || right.name || right.id)))
      .forEach((junction, junctionIndex) => {
        const junctionKey = fiberMapNodeKey('junction', junction.id);
        const sourceNode = baseNodeMap.get(junction.sourceKey);
        const fallback = {
          x: (sourceNode?.x || 760) + 310,
          y: (sourceNode?.y || FIBER_MAPPING_GROUP_TOP) + (junctionIndex % 4) * 166
        };
        const junctionNode = nodeFromStored(
          junctionKey,
          fallback,
          FIBER_MAPPING_NODE_SIZE.junction,
          {
            type: 'junction',
            source: junction,
            label: junction.name || 'Junction Box',
            detail: sourceNode ? `From ${sourceNode.label}` : 'Junction Box',
            status: junction.status || 'ACTIVE',
            sourceKey: junction.sourceKey,
            oltId: sourceNode?.oltId || junction.oltId || '',
            ponId: sourceNode?.type === 'pon' ? sourceNode.source?.id : sourceNode?.ponId || junction.ponId || '',
            splitterIds: mapping.containerSplitters?.[junctionKey] || [],
            splitterAssignments: mapping.containerSplitterAssignments?.[junctionKey] || [],
            connectionPoints: mapping.connectionPoints || {}
          }
        );
        nodes.push(junctionNode);
        baseNodeMap.set(junctionKey, junctionNode);
      });

    Object.values(mapping.junctionBoxes || {})
      .filter((junction) => junction?.id && junction?.sourceKey)
      .forEach((junction) => {
        const junctionKey = fiberMapNodeKey('junction', junction.id);
        const sourceNode = baseNodeMap.get(junction.sourceKey);
        const junctionNode = baseNodeMap.get(junctionKey);
        if (!sourceNode || !junctionNode) return;
        edges.push({
          id: fiberMapEdgeKey(junction.sourceKey, junctionKey),
          type: `${sourceNode.type}-junction`,
          fromKey: junction.sourceKey,
          toKey: junctionKey,
          junctionId: junction.id,
          splitterIds: mapping.containerSplitters?.[junctionKey] || [],
          splitterAssignments: mapping.containerSplitterAssignments?.[junctionKey] || [],
          label: `${sourceNode.label} / ${junction.name || 'Junction Box'}`
        });
      });

    const treeLayout = fiberMappingTreeLayout(nodes, edges, fiberMappingExpandedContainerKeys);
    const renderNodes = treeLayout.nodes;
    const nodeMap = new Map(renderNodes.map((node) => [node.key, node]));
    const shapedEdges = edges
      .map((edge) => {
        const from = nodeMap.get(edge.fromKey) || nodeMap.get(edge.fallbackFromKey);
        const to = nodeMap.get(edge.toKey);
        if (!from || !to) return null;
        const config = { ...defaultFiberEdgeConfig(), ...(mapping.edges?.[edge.id] || {}) };
        const budget = fiberMappingEdgeBudget(config, edge, fiberOptics, splittersById, ponsById);
        const fromAnchor = fiberMappingNodeAnchorSize(from, fiberMappingExpandedContainerKeys);
        const toAnchor = fiberMappingNodeAnchorSize(to, fiberMappingExpandedContainerKeys);
        const fromX = from.x + fromAnchor.width;
        const fromY = from.y + fromAnchor.height / 2;
        const toX = to.x;
        const toY = to.y + toAnchor.height / 2;
        const midX = fromX + Math.max(70, (toX - fromX) / 2);
        return {
          ...edge,
          config,
          budget,
          path: `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`,
          labelX: (fromX + toX) / 2,
          labelY: (fromY + toY) / 2
        };
      })
      .filter(Boolean);
    return {
      nodes: renderNodes,
      edges: shapedEdges,
      canvas: {
        width: treeLayout.canvas.width,
        height: treeLayout.canvas.height
      },
      totals: {
        olts: renderNodes.filter((node) => node.type === 'olt').length,
        pons: renderNodes.filter((node) => node.type === 'pon').length,
        naps: renderNodes.filter((node) => node.type === 'nap').length,
        junctions: renderNodes.filter((node) => node.type === 'junction').length,
        locked: renderNodes.filter((node) => node.locked).length,
        links: shapedEdges.length
      }
    };
  }, [fiberMapping, fiberMappingExpandedContainerKeys, fiberOptics, fbts, naps, napsById, olts, pons, ponsById, splittersById]);
  const selectedFiberMappingEdge = useMemo(
    () => fiberMappingCanvas.edges.find((edge) => edge.id === fiberMappingSelectedEdgeId) || null,
    [fiberMappingCanvas.edges, fiberMappingSelectedEdgeId]
  );
  const ponFiberLinkCanvas = useMemo(() => {
    const settings = normalizeFiberLinkSettings(fiberMapping?.fiberLinkSettings);
    const rootKey = fiberLinkCanvasPonId ? fiberMapNodeKey('pon', fiberLinkCanvasPonId) : '';
    const nodeByKey = new Map(fiberMappingCanvas.nodes.map((node) => [node.key, node]));
    const rootNode = nodeByKey.get(rootKey);
    const emptyCanvas = {
      pon: rootNode || null,
      nodes: rootNode ? [{
        ...rootNode,
        x: 40,
        y: 48,
        width: 164,
        height: 68
      }] : [],
      edges: [],
      canvas: { width: 520, height: 220 },
      settings,
      maxLengthKm: 0
    };
    if (!rootNode) return emptyCanvas;

    const edgesByFrom = new Map();
    fiberMappingCanvas.edges.forEach((edge) => {
      if (edge.type === 'olt-pon') return;
      if (!nodeByKey.has(edge.fromKey) || !nodeByKey.has(edge.toKey)) return;
      const current = edgesByFrom.get(edge.fromKey) || [];
      current.push(edge);
      edgesByFrom.set(edge.fromKey, current);
    });
    edgesByFrom.forEach((edges) => {
      edges.sort((left, right) => {
        const leftNode = nodeByKey.get(left.toKey) || {};
        const rightNode = nodeByKey.get(right.toKey) || {};
        return String(leftNode.label || '').localeCompare(String(rightNode.label || ''));
      });
    });

    const reachableKeys = new Set([rootKey]);
    const canvasEdges = [];
    const queue = [rootKey];
    const seenEdges = new Set();
    while (queue.length) {
      const fromKey = queue.shift();
      (edgesByFrom.get(fromKey) || []).forEach((edge) => {
        if (seenEdges.has(edge.id)) return;
        seenEdges.add(edge.id);
        reachableKeys.add(edge.toKey);
        canvasEdges.push(edge);
        queue.push(edge.toKey);
      });
    }

    const maxLengthKm = Math.max(0, ...canvasEdges.map(fiberLinkLengthKm));
    const nodeSizeByType = {
      pon: { width: 164, height: 68 },
      nap: { width: 196, height: 78 },
      junction: { width: 188, height: 72 }
    };
    const layoutNodes = new Map();
    let leafIndex = 0;
    const rowGap = 126;
    const topPad = 48;
    const leftPad = 40;
    const inProgress = new Set();

    const layoutNode = (nodeKey, x, depth = 0) => {
      if (layoutNodes.has(nodeKey)) return layoutNodes.get(nodeKey);
      if (inProgress.has(nodeKey)) {
        const fallbackNode = nodeByKey.get(nodeKey) || {};
        return {
          ...fallbackNode,
          x,
          y: topPad + leafIndex * rowGap,
          width: nodeSizeByType[fallbackNode.type]?.width || 180,
          height: nodeSizeByType[fallbackNode.type]?.height || 72,
          depth
        };
      }
      inProgress.add(nodeKey);
      const node = nodeByKey.get(nodeKey) || {};
      const size = nodeSizeByType[node.type] || { width: 180, height: 72 };
      const childEdges = (edgesByFrom.get(nodeKey) || []).filter((edge) => reachableKeys.has(edge.toKey));
      const childLayouts = childEdges.map((edge) => {
        const lengthKm = fiberLinkLengthKm(edge);
        const segmentPixels = fiberLinkSegmentPixels(lengthKm, maxLengthKm, settings);
        return layoutNode(edge.toKey, x + size.width + segmentPixels, depth + 1);
      });
      let y;
      if (childLayouts.length) {
        const childCenters = childLayouts.map((child) => child.y + child.height / 2);
        y = (childCenters.reduce((total, value) => total + value, 0) / childCenters.length) - size.height / 2;
      } else {
        y = topPad + leafIndex * rowGap;
        leafIndex += 1;
      }
      const layout = {
        ...node,
        x,
        y: Math.max(topPad, Math.round(y)),
        width: size.width,
        height: size.height,
        depth
      };
      layoutNodes.set(nodeKey, layout);
      inProgress.delete(nodeKey);
      return layout;
    };

    layoutNode(rootKey, leftPad, 0);
    const displayEdges = canvasEdges.map((edge) => {
      const from = layoutNodes.get(edge.fromKey);
      const to = layoutNodes.get(edge.toKey);
      if (!from || !to) return null;
      const lengthKm = fiberLinkLengthKm(edge);
      const segmentPixels = fiberLinkSegmentPixels(lengthKm, maxLengthKm, settings);
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;
      const dx = Math.max(24, endX - startX);
      const control = clamp(dx * 0.5, 30, 180);
      const midX = startX + dx / 2;
      const midY = startY + (endY - startY) / 2;
      return {
        ...edge,
        lengthKm,
        segmentPixels,
        sizePercent: Math.round((segmentPixels / settings.maxLinePixels) * 100),
        d: `M ${startX} ${startY} C ${startX + control} ${startY} ${endX - control} ${endY} ${endX} ${endY}`,
        startX,
        startY,
        endX,
        endY,
        midX,
        midY,
        assigned: Boolean(edge.config?.fiberOpticLossId)
      };
    }).filter(Boolean);
    const displayNodes = Array.from(layoutNodes.values()).sort((left, right) => left.depth - right.depth || left.y - right.y);
    const width = Math.max(520, ...displayNodes.map((node) => node.x + node.width + 80), ...displayEdges.map((edge) => edge.endX + 180));
    const height = Math.max(220, ...displayNodes.map((node) => node.y + node.height + 80), ...displayEdges.map((edge) => edge.midY + 80));
    return {
      pon: rootNode,
      nodes: displayNodes,
      edges: displayEdges,
      canvas: { width, height },
      settings,
      maxLengthKm
    };
  }, [fiberLinkCanvasPonId, fiberMapping?.fiberLinkSettings, fiberMappingCanvas.edges, fiberMappingCanvas.nodes]);
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
    () => devices
      .filter((device) => (
        device.accessMethod === deviceScope.accessMethod
        && (!deviceScope.deviceType || device.deviceType === deviceScope.deviceType)
        && matches(device, search)
      ))
      .sort(sortByDisplayOrder),
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
    const mapping = normalizeFiberMapping(fiberMapping);
    const mappedNapNodes = Object.entries(mapping.nodes || {})
      .filter(([key]) => key.startsWith('nap:'))
      .map(([key, node]) => ({
        id: key.slice(4),
        key,
        sourceKey: node?.sourceKey || ''
      }))
      .filter((node) => napsById.has(node.id));
    const mappedNapIds = new Set(mappedNapNodes.map((node) => node.id));
    const napSourceKeyById = new Map(mappedNapNodes.map((node) => [node.id, node.sourceKey]));
    const mapNaps = naps.filter((nap) => (
      mappedNapIds.has(nap.id)
      && matches(nap, search)
      && (!mapOltFilter || nap.oltId === mapOltFilter)
    ));
    const mapOlts = olts.filter((olt) => (
      (!mapOltFilter || olt.id === mapOltFilter)
      && (matches(olt, search) || mapNaps.some((nap) => nap.oltId === olt.id) || !String(search || '').trim())
    ));
    const resolveMapFiberSource = (sourceKey, fallbackOltId, visited = new Set()) => {
      const key = String(sourceKey || '').trim();
      if (!key || visited.has(key)) {
        return fallbackOltId ? { type: 'olt', id: fallbackOltId } : null;
      }
      visited.add(key);
      if (key.startsWith('nap:')) {
        const napId = key.slice(4);
        return mappedNapIds.has(napId) ? { type: 'nap', id: napId } : null;
      }
      if (key.startsWith('pon:')) {
        const pon = ponsById.get(key.slice(4));
        return pon?.oltId ? { type: 'olt', id: pon.oltId } : fallbackOltId ? { type: 'olt', id: fallbackOltId } : null;
      }
      if (key.startsWith('olt:')) {
        const oltId = key.slice(4);
        return oltId ? { type: 'olt', id: oltId } : null;
      }
      if (key.startsWith('junction:')) {
        const junction = mapping.junctionBoxes?.[key.slice(9)];
        return resolveMapFiberSource(junction?.sourceKey, fallbackOltId, visited);
      }
      return fallbackOltId ? { type: 'olt', id: fallbackOltId } : null;
    };
    const mapFiberLinks = mapNaps.map((nap) => {
      const napKey = fiberMapNodeKey('nap', nap.id);
      const fallbackSourceKey = nap.ponPortId ? fiberMapNodeKey('pon', nap.ponPortId) : '';
      const sourceKey = napSourceKeyById.get(nap.id) || fallbackSourceKey;
      const effectiveSourceKey = sourceKey === napKey ? fallbackSourceKey : sourceKey;
      const source = resolveMapFiberSource(effectiveSourceKey, nap.oltId);
      if (!source || (source.type === 'nap' && source.id === nap.id)) return null;
      return {
        id: fiberMapEdgeKey(effectiveSourceKey, napKey),
        fromType: source.type,
        fromId: source.id,
        toId: nap.id,
        edgeId: fiberMapEdgeKey(effectiveSourceKey, napKey)
      };
    }).filter(Boolean);
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
    const tileProvider = activeTileProvider;
    const tileProviderId = tileProvider?.id || 'map';
    const maxNativeTileZoom = maxNativeTileZoomForMode(tileProvider);
    const tileZoom = clamp(baseZoom + tileBoost + detailBoost, 1, maxNativeTileZoom);
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
        const tileSrc = mapTileUrl(tileX, tileY, tileZoom, tileProvider);
        if (!tileSrc) continue;
        tiles.push({
          id: `${tileProviderId}-${tileZoom}-${tileX}-${tileY}`,
          src: tileSrc,
          x: tilePoint.x,
          y: tilePoint.y,
          size: 256 * tileScale
        });
      }
    }
    const projectCoordinates = (latitude, longitude) => {
      const lat = parseCoordinate(latitude);
      const lng = parseCoordinate(longitude);
      if (lat === null || lng === null) return null;
      const world = geoToWorldPixel(lat, lng, baseZoom);
      return {
        x: canvas.width / 2 + world.x - centerWorld.x,
        y: canvas.height / 2 + world.y - centerWorld.y,
        coordinateSource: 'GPS'
      };
    };
    const project = (row) => projectCoordinates(row.latitude, row.longitude);
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
    const napNodes = mapNaps.map((nap) => {
      const parentPon = ponsById.get(nap.ponPortId);
      return {
        id: `nap-${nap.id}`,
        sourceId: nap.id,
        parentOltId: nap.oltId,
        type: 'nap',
        label: nap.name,
        detail: [nap.oltName, nap.ponLabel, nap.barangay].filter(Boolean).join(' / ') || 'NAP Box',
        status: nap.status,
        splitterRatio: formatSplitterRatio(nap.splitterRatio),
        fbtCount: nap.fbtCount,
        ponColorHex: parentPon ? ponColor(parentPon, meta.ponColorPalette) : normalizeHexColor(nap.ponColorHex, PON_COLOR_BASES[0]),
        ...napPositions.get(nap.id)
      };
    }).filter((node) => node.x !== undefined && node.y !== undefined);
    const nodes = [
      ...(showOltMarkers ? oltNodes : []),
      ...(showNapMarkers ? napNodes : [])
    ].map((node) => ({ ...node, ...screenPoint(node) }));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const showLinks = mapLayerVisibility.links && showNapMarkers;
    const lines = !showLinks ? [] : mapFiberLinks.map((link) => {
      const parent = link.fromType === 'nap' ? napPositions.get(link.fromId) : oltPositions.get(link.fromId);
      const child = napPositions.get(link.toId);
      if (!parent || !child) return null;
      const parentPoint = screenPoint(parent);
      const childPoint = screenPoint(child);
      const parentNodeId = `${link.fromType}-${link.fromId}`;
      const childNodeId = `nap-${link.toId}`;
      const targetNap = napsById.get(link.toId);
      const sourceNap = link.fromType === 'nap' ? napsById.get(link.fromId) : null;
      const sourceOlt = link.fromType === 'olt' ? olts.find((olt) => olt.id === link.fromId) : null;
      const lineOlt = olts.find((olt) => olt.id === (targetNap?.oltId || sourceNap?.oltId || sourceOlt?.id));
      const lineOltName = lineOlt?.name || targetNap?.oltName || sourceNap?.oltName || sourceOlt?.name || 'OLT';
      const sourceName = sourceNap?.name || sourceOlt?.name || lineOltName;
      const targetName = targetNap?.name || `NAP ${link.toId}`;
      const lineLabel = link.fromType === 'nap'
        ? `${lineOltName}:${sourceName}-${targetName} LINE`
        : `${lineOltName}-${targetName} LINE`;
      const config = { ...defaultFiberEdgeConfig(), ...(mapping.edges?.[link.edgeId] || {}) };
      const lineProfile = fiberOptics.find((profile) => profile.id === config.fiberOpticLossId);
      const lineStyle = String(config.lineStyle || '').toUpperCase();
      const bendPoints = normalizeMapBendPoints(config.mapBendPoints)
        .map((point, index) => {
          const projected = Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
            ? projectCoordinates(point.latitude, point.longitude)
            : null;
          const rendered = projected || (Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null);
          if (!rendered) return null;
          return {
            ...point,
            index,
            ...screenPoint(rendered)
          };
        })
        .filter(Boolean);
      return {
        id: link.edgeId,
        label: lineLabel,
        config,
        fromNodeId: parentNodeId,
        toNodeId: childNodeId,
        x1: parentPoint.x,
        y1: parentPoint.y,
        x2: childPoint.x,
        y2: childPoint.y,
        lineColor: fiberLineColorForConfig(config, lineProfile),
        dash: lineStyle === 'DASHED' ? '10 7' : lineStyle === 'DOTTED' ? '2 7' : '',
        bendPoints,
        visible: visibleNodeIds.has(parentNodeId) && visibleNodeIds.has(childNodeId)
      };
    }).filter((line) => line?.visible);
    return {
      canvas,
      surface,
      nodes,
      lines,
      tiles,
      projection: {
        baseZoom,
        centerWorld,
        canvas,
        surface,
        mapScale,
        panX,
        panY
      },
      baseZoom,
      tileZoom,
      viewZoom: baseZoom + Math.log2(mapScale),
      nativeTileMaxed: tileZoom >= maxNativeTileZoom,
      tileMode: tileProviderId,
      tileProvider,
      tileAttribution: tileProvider?.attribution || tileProvider?.label || 'Map tiles',
      mapMode: geoPoints.length ? 'GPS map' : 'Topology',
      totals: {
        olts: nodes.filter((node) => node.type === 'olt').length,
        naps: nodes.filter((node) => node.type === 'nap').length,
        gps: nodes.filter((node) => node.coordinateSource === 'GPS').length
      }
    };
  }, [fiberMapping, olts, naps, napsById, ponsById, search, mapOltFilter, mapTypeFilter, mapSurfaceSize, mapView, activeTileProvider, mapHighDetail, mapLayerVisibility, meta.ponColorPalette]);

  const serviceabilityMap = useMemo(() => {
    const surface = {
      width: Math.max(320, Number(serviceabilitySurfaceSize.width) || DEFAULT_MAP_SURFACE.width),
      height: Math.max(320, Number(serviceabilitySurfaceSize.height) || DEFAULT_MAP_SURFACE.height)
    };
    const canvas = { width: surface.width, height: surface.height };
    const mapScale = clamp(Number(serviceabilityView.zoom) || 1, MAP_MIN_SCALE, SERVICEABILITY_MAP_MAX_SCALE);
    const panX = Number(serviceabilityView.panX) || 0;
    const panY = Number(serviceabilityView.panY) || 0;
    const houseCoordinates = rowCoordinates(serviceabilityHouse);
    const selectedCustomer = customerProfiles.find((customer) => customer.id === serviceabilityCustomerId) || null;
    const customerMapping = serviceabilityCustomerMapping(selectedCustomer);
    const geoPoints = [
      ...selectedServiceabilityNapCandidates.map((nap) => nap.coordinates).filter(Boolean),
      ...(houseCoordinates ? [houseCoordinates] : [])
    ];
    const mapCenter = geoPoints.length
      ? {
        lat: geoPoints.reduce((total, point) => total + point.latitude, 0) / geoPoints.length,
        lng: geoPoints.reduce((total, point) => total + point.longitude, 0) / geoPoints.length
      }
      : { lat: 14.5995, lng: 120.9842 };
    let baseZoom = geoPoints.length > 1 ? 16 : 17;
    if (geoPoints.length > 1) {
      for (let candidateZoom = 18; candidateZoom >= 10; candidateZoom -= 1) {
        const projected = geoPoints.map((point) => geoToWorldPixel(point.latitude, point.longitude, candidateZoom));
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
    const tileProvider = activeTileProvider;
    const tileProviderId = tileProvider?.id || 'map';
    const maxNativeTileZoom = maxNativeTileZoomForMode(tileProvider);
    const tileZoom = clamp(baseZoom + tileBoost + detailBoost, 1, maxNativeTileZoom);
    const tileZoomRatio = 2 ** (tileZoom - baseZoom);
    const tileScale = mapScale / tileZoomRatio;
    const tileCenterWorld = {
      x: centerWorld.x * tileZoomRatio,
      y: centerWorld.y * tileZoomRatio
    };
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
        const tileSrc = mapTileUrl(tileX, tileY, tileZoom, tileProvider);
        if (!tileSrc) continue;
        tiles.push({
          id: `serviceability-${tileProviderId}-${tileZoom}-${tileX}-${tileY}`,
          src: tileSrc,
          x: tilePoint.x,
          y: tilePoint.y,
          size: 256 * tileScale
        });
      }
    }
    const projectCoordinates = (coordinates) => {
      if (!coordinates) return null;
      const world = geoToWorldPixel(coordinates.latitude, coordinates.longitude, baseZoom);
      return {
        x: surface.width / 2 + (world.x - centerWorld.x) * mapScale + panX,
        y: surface.height / 2 + (world.y - centerWorld.y) * mapScale + panY
      };
    };
    const napNodes = selectedServiceabilityNapCandidates.map((nap) => {
      const coordinates = nap.coordinates;
      const point = projectCoordinates(coordinates);
      if (!point) return null;
      return {
        ...nap,
        coordinates,
        customerMapped: sameServiceabilityId(nap.sourceId, customerMapping.napId),
        mappedPortNumber: sameServiceabilityId(nap.sourceId, customerMapping.napId) ? customerMapping.portNumber : 0,
        mappedSplitterId: customerMapping.splitterId,
        mappedSplitterAssignmentId: customerMapping.assignmentId,
        distanceMeters: houseCoordinates ? haversineMeters(houseCoordinates, coordinates) : null,
        ...point
      };
    }).filter(Boolean);
    const sortedCandidates = houseCoordinates
      ? [...napNodes].filter((node) => Number.isFinite(node.distanceMeters)).sort((left, right) => left.distanceMeters - right.distanceMeters)
      : [];
    const selectedNap = napNodes.find((node) => node.sourceId === serviceabilitySelectedNapId)
      || sortedCandidates.find((node) => node.serviceable)
      || sortedCandidates[0]
      || null;
    const housePoint = projectCoordinates(houseCoordinates);
    const houseNode = houseCoordinates && housePoint
      ? {
        id: 'customer-house',
        type: 'house',
        label: serviceabilityCustomerId
          ? customerDisplayName(customerProfiles.find((customer) => customer.id === serviceabilityCustomerId))
          : 'Customer House',
        coordinates: houseCoordinates,
        ...housePoint
      }
      : null;
    const link = selectedNap && houseNode
      ? {
        id: `serviceability-${selectedNap.sourceId}`,
        status: selectedNap.customerMapped || selectedNap.serviceable ? 'connected' : 'disconnected',
        nap: selectedNap,
        house: houseNode,
        path: mapLinkPath([selectedNap, houseNode]),
        midpoint: {
          x: (selectedNap.x + houseNode.x) / 2,
          y: (selectedNap.y + houseNode.y) / 2
        }
      }
      : null;
    return {
      surface,
      tiles,
      napNodes,
      houseNode,
      selectedNap,
      link,
      projection: {
        baseZoom,
        centerWorld,
        surface,
        mapScale,
        panX,
        panY
      },
      tileZoom,
      tileScale,
      maxNativeTileZoom,
      viewZoom: baseZoom + Math.log2(mapScale),
      nativeTileMaxed: tileZoom >= maxNativeTileZoom,
      tileMode: tileProviderId,
      tileProvider,
      tileAttribution: tileProvider?.attribution || tileProvider?.label || 'Map tiles',
      totals: {
        naps: napNodes.length,
        serviceable: napNodes.filter((node) => node.serviceable).length,
        full: napNodes.filter((node) => !node.serviceable).length
      }
    };
  }, [selectedServiceabilityNapCandidates, serviceabilityHouse, serviceabilitySelectedNapId, serviceabilitySurfaceSize, serviceabilityView, serviceabilityCustomerId, customerProfiles, activeTileProvider, mapHighDetail]);

  const serviceabilityTileSignature = useMemo(
    () => mapTileSignature(serviceabilityMap.tiles),
    [serviceabilityMap.tiles]
  );
  const serviceabilityReadyTileSignature = useMemo(
    () => mapTileSignature(serviceabilityReadyTiles),
    [serviceabilityReadyTiles]
  );
  const serviceabilityHasReadyFallback = Boolean(serviceabilityReadyTiles.length && serviceabilityReadyTileSignature !== serviceabilityTileSignature);
  const serviceabilityCurrentTilesReady = Boolean(serviceabilityMap.tiles.length && serviceabilityMap.tiles.every((tile) => serviceabilityLoadedTileIds[tile.id]));
  useEffect(() => {
    if (!serviceabilityMap.tiles.length) {
      serviceabilityReadyTileSignatureRef.current = '';
      setServiceabilityReadyTiles([]);
      return;
    }
    if (!serviceabilityCurrentTilesReady) return;
    if (serviceabilityReadyTileSignatureRef.current === serviceabilityTileSignature) return;
    serviceabilityReadyTileSignatureRef.current = serviceabilityTileSignature;
    setServiceabilityReadyTiles(serviceabilityMap.tiles);
  }, [serviceabilityCurrentTilesReady, serviceabilityMap.tiles, serviceabilityTileSignature]);

  const selectedMapLine = useMemo(
    () => networkMap.lines.find((line) => line.id === mapSelectedLineId) || null,
    [networkMap.lines, mapSelectedLineId]
  );
  useEffect(() => {
    if (!mapSelectedLineId || selectedMapLine) return;
    setMapSelectedLineId('');
    setMapLineEditMode(false);
    setMapHideOtherLines(false);
    setMapLinePopover(null);
    setMapLineMessage('');
    mapLineBendDragRef.current = null;
    mapLinePopoverDragRef.current = null;
  }, [mapSelectedLineId, selectedMapLine]);
  const oltLocationPickerMap = useMemo(() => {
    const surface = {
      width: Math.max(300, Number(oltLocationPickerSurfaceSize.width) || DEFAULT_OLT_LOCATION_PICKER_SURFACE.width),
      height: Math.max(260, Number(oltLocationPickerSurfaceSize.height) || DEFAULT_OLT_LOCATION_PICKER_SURFACE.height)
    };
    const tileProvider = activeTileProvider;
    const tileProviderId = tileProvider?.id || 'map';
    const zoom = clamp(Math.round(Number(oltLocationPickerView.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom), 10, maxNativeTileZoomForMode(tileProvider));
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
        const tileSrc = mapTileUrl(tileX, tileY, zoom, tileProvider);
        if (!tileSrc) continue;
        tiles.push({
          id: `${tileProviderId}-${zoom}-${tileX}-${tileY}`,
          src: tileSrc,
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
    return { surface, zoom, centerWorld, tiles, marker, tileProvider };
  }, [oltLocationForm.latitude, oltLocationForm.longitude, oltLocationPickerSurfaceSize, oltLocationPickerView, activeTileProvider]);

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
    setMapLayerVisibility((current) => {
      const normalized = normalizeMapLayerVisibility(current);
      return { ...normalized, [layerKey]: !normalized[layerKey] };
    });
  }

  function mapSurfacePointFromEvent(event) {
    const rect = mapSurfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function mapScreenPointToGeo(x, y) {
    const projection = networkMap.projection;
    if (!projection) return null;
    const worldX = projection.centerWorld.x + (Number(x) - projection.surface.width / 2 - projection.panX) / projection.mapScale;
    const worldY = projection.centerWorld.y + (Number(y) - projection.surface.height / 2 - projection.panY) / projection.mapScale;
    const captured = worldPixelToGeo(worldX, worldY, projection.baseZoom);
    if (!Number.isFinite(captured.latitude) || !Number.isFinite(captured.longitude)) return null;
    return {
      latitude: captured.latitude,
      longitude: captured.longitude
    };
  }

  function mapScreenPointToCanvas(x, y) {
    const projection = networkMap.projection;
    if (!projection) return null;
    return {
      x: projection.canvas.width / 2 + (Number(x) - projection.surface.width / 2 - projection.panX) / projection.mapScale,
      y: projection.canvas.height / 2 + (Number(y) - projection.surface.height / 2 - projection.panY) / projection.mapScale
    };
  }

  function mapBendPointFromSurfacePoint(point) {
    if (!point) return null;
    const coordinates = mapScreenPointToGeo(point.x, point.y);
    const canvasPoint = mapScreenPointToCanvas(point.x, point.y);
    if (!coordinates && !canvasPoint) return null;
    return {
      ...(coordinates ? {
        latitude: Number(coordinates.latitude.toFixed(7)),
        longitude: Number(coordinates.longitude.toFixed(7))
      } : {}),
      ...(canvasPoint ? {
        x: Number(canvasPoint.x.toFixed(2)),
        y: Number(canvasPoint.y.toFixed(2))
      } : {})
    };
  }

  function mapLinePoints(line, fromDraft = null, toDraft = null) {
    return [
      { x: fromDraft?.x ?? line.x1, y: fromDraft?.y ?? line.y1 },
      ...(line.bendPoints || []).map((point) => ({ x: point.x, y: point.y, index: point.index })),
      { x: toDraft?.x ?? line.x2, y: toDraft?.y ?? line.y2 }
    ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  function nextFiberMappingWithMapBendPoints(source, lineId, bendPoints) {
    const mapping = normalizeFiberMapping(source);
    const existing = mapping.edges?.[lineId] || {};
    const config = {
      ...defaultFiberEdgeConfig(),
      ...existing,
      mapBendPoints: normalizeMapBendPoints(bendPoints)
    };
    return {
      ...mapping,
      edges: {
        ...mapping.edges,
        [lineId]: config
      }
    };
  }

  function setLocalMapLineBendPoints(lineId, bendPoints) {
    const next = nextFiberMappingWithMapBendPoints(fiberMappingRef.current || fiberMapping, lineId, bendPoints);
    fiberMappingRef.current = next;
    setFiberMapping(next);
  }

  async function saveMapLineBendPoints(lineId, bendPoints, successMessage = 'Line bend saved.', options = {}) {
    const next = nextFiberMappingWithMapBendPoints(fiberMappingRef.current || fiberMapping, lineId, bendPoints);
    setMapSavingLineId(lineId);
    setMapLineMessage('Saving line bend...');
    await saveFiberMapping(next, successMessage, { undoSnapshot: options.undoSnapshot || fiberMapping });
    setMapLineMessage(successMessage);
    setMapSavingLineId('');
  }

  function placeMapLinePopover(event) {
    const point = mapSurfacePointFromEvent(event);
    return clampMapLinePopoverPosition(
      (point?.x || (networkMap.surface?.width || mapSurfaceSize.width || DEFAULT_MAP_SURFACE.width) / 2) + 10,
      (point?.y || (networkMap.surface?.height || mapSurfaceSize.height || DEFAULT_MAP_SURFACE.height) / 2) + 10
    );
  }

  function clampMapLinePopoverPosition(x, y) {
    const surfaceWidth = networkMap.surface?.width || mapSurfaceSize.width || DEFAULT_MAP_SURFACE.width;
    const surfaceHeight = networkMap.surface?.height || mapSurfaceSize.height || DEFAULT_MAP_SURFACE.height;
    const width = 238;
    const height = 124;
    return {
      x: clamp(Number(x) || 12, 12, Math.max(12, surfaceWidth - width - 12)),
      y: clamp(Number(y) || 12, 12, Math.max(12, surfaceHeight - height - 12))
    };
  }

  function selectServiceabilityCustomer(customerId) {
    setServiceabilityCustomerId(customerId);
    setServiceabilityNapDetailId('');
    setServiceabilityMapMenuOpen(false);
    const customer = customerProfiles.find((row) => row.id === customerId);
    const coordinates = rowCoordinates(customer);
    if (coordinates) {
      setServiceabilityHouse({
        latitude: coordinates.latitude.toFixed(6),
        longitude: coordinates.longitude.toFixed(6)
      });
      setServiceabilitySelectedNapId('');
      resetServiceabilityView();
    } else {
      setServiceabilityHouse({ latitude: '', longitude: '' });
      setServiceabilitySelectedNapId('');
    }
  }

  function zoomServiceabilityAt(multiplier, clientX = null, clientY = null) {
    const surfaceNode = serviceabilitySurfaceRef.current;
    const rect = surfaceNode?.getBoundingClientRect();
    const surfaceWidth = rect?.width || serviceabilitySurfaceSize.width || DEFAULT_MAP_SURFACE.width;
    const surfaceHeight = rect?.height || serviceabilitySurfaceSize.height || DEFAULT_MAP_SURFACE.height;
    const pointX = rect && clientX !== null ? clientX - rect.left : surfaceWidth / 2;
    const pointY = rect && clientY !== null ? clientY - rect.top : surfaceHeight / 2;

    setServiceabilityView((current) => {
      const currentZoom = clamp(Number(current.zoom) || 1, MAP_MIN_SCALE, SERVICEABILITY_MAP_MAX_SCALE);
      const nextZoom = clamp(Number((currentZoom * multiplier).toFixed(4)), MAP_MIN_SCALE, SERVICEABILITY_MAP_MAX_SCALE);
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

  function resetServiceabilityView() {
    setServiceabilityView({ zoom: 1, panX: 0, panY: 0 });
  }

  function markServiceabilityTileLoaded(tileId) {
    if (!tileId) return;
    setServiceabilityLoadedTileIds((current) => {
      if (current[tileId]) return current;
      return { ...current, [tileId]: true };
    });
  }

  function startServiceabilityPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.network-serviceability-nap-detail, .network-serviceability-marker, .network-map-toolbar')) return;
    serviceabilityDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: serviceabilityView.panX,
      panY: serviceabilityView.panY,
      moved: false
    };
    setServiceabilityDragging(true);
  }

  function moveServiceabilityPan(event) {
    const drag = serviceabilityDragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;
    setServiceabilityView((current) => ({
      ...current,
      panX: drag.panX + deltaX,
      panY: drag.panY + deltaY
    }));
  }

  function endServiceabilityPan() {
    const drag = serviceabilityDragRef.current;
    if (!drag) return;
    serviceabilityDragRef.current = null;
    setServiceabilityDragging(false);
  }

  function selectMapLine(event, line) {
    event.stopPropagation();
    setMapFocusedNodeId('');
    setMapSelectedLineId(line.id);
    setMapLineEditMode(false);
    setMapLinePopover({ lineId: line.id, ...placeMapLinePopover(event) });
    setMapLineMessage('Viewing line details. Enable edit to add bend points.');
    setMapMarkerSaveError('');
  }

  function setMapLineEditEnabled(line, enabled) {
    if (!line) return;
    setMapSelectedLineId(line.id);
    setMapLineEditMode(Boolean(enabled));
    setMapLineMessage(enabled
      ? 'Left-click the line to add a bend circle.'
      : 'Viewing line details. Enable edit to add bend points.');
  }

  async function resetMapLineBends(line) {
    if (!line) return;
    setMapLineEditMode(false);
    await saveMapLineBendPoints(line.id, [], 'Line bends reset.');
  }

  async function removeMapLineBendPoint(event, line, pointIndex) {
    event.stopPropagation();
    event.preventDefault();
    if (!line) return;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const bendPoints = normalizeMapBendPoints(mapping.edges?.[line.id]?.mapBendPoints || line.config?.mapBendPoints);
    if (!bendPoints[pointIndex]) return;
    const nextBendPoints = bendPoints.filter((_, index) => index !== pointIndex);
    setMapSelectedLineId(line.id);
    setMapLineEditMode(true);
    await saveMapLineBendPoints(line.id, nextBendPoints, 'Line bend point removed.');
  }

  async function handleMapLinePathClick(event, line, points) {
    if (mapLineEditMode && mapSelectedLineId && mapSelectedLineId !== line.id) {
      event.stopPropagation();
      event.preventDefault();
      setMapLineMessage('Turn off Edit Line before selecting another line.');
      return;
    }
    if (mapLineEditMode && mapSelectedLineId === line.id) {
      event.stopPropagation();
      const point = mapSurfacePointFromEvent(event);
      const bendPoint = mapBendPointFromSurfacePoint(point);
      if (!bendPoint) return;
      const bendPoints = normalizeMapBendPoints(line.config?.mapBendPoints);
      const insertIndex = nearestMapLinkSegmentIndex(points, point || { x: line.x1, y: line.y1 });
      const nextBendPoints = [...bendPoints];
      nextBendPoints.splice(insertIndex, 0, bendPoint);
      setMapSelectedLineId(line.id);
      await saveMapLineBendPoints(line.id, nextBendPoints, 'Line bend point added.');
      return;
    }
    selectMapLine(event, line);
  }

  function startMapLinePopoverDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.stopPropagation();
    event.preventDefault();
    mapLinePopoverDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: mapLinePopover?.x || 12,
      y: mapLinePopover?.y || 12
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveMapLinePopoverDrag(event) {
    const drag = mapLinePopoverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setMapLinePopover((current) => {
      if (!current) return current;
      return {
        ...current,
        ...clampMapLinePopoverPosition(
          drag.x + event.clientX - drag.clientX,
          drag.y + event.clientY - drag.clientY
        )
      };
    });
  }

  function endMapLinePopoverDrag(event) {
    const drag = mapLinePopoverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    mapLinePopoverDragRef.current = null;
  }

  function startMapLineBendDrag(event, line, pointIndex) {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || !line) return;
    setMapSelectedLineId(line.id);
    setMapLineEditMode(true);
    setMapLineMessage('Dragging line bend...');
    mapLineBendDragRef.current = {
      pointerId: event.pointerId,
      lineId: line.id,
      pointIndex,
      undoSnapshot: normalizeFiberMapping(fiberMappingRef.current || fiberMapping)
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveMapLineBendDrag(event) {
    const drag = mapLineBendDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = mapSurfacePointFromEvent(event);
    const bendPoint = mapBendPointFromSurfacePoint(point);
    if (!bendPoint) return;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const bendPoints = normalizeMapBendPoints(mapping.edges?.[drag.lineId]?.mapBendPoints);
    if (!bendPoints[drag.pointIndex]) return;
    bendPoints[drag.pointIndex] = bendPoint;
    setLocalMapLineBendPoints(drag.lineId, bendPoints);
  }

  async function endMapLineBendDrag(event) {
    const drag = mapLineBendDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    mapLineBendDragRef.current = null;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const bendPoints = normalizeMapBendPoints(mapping.edges?.[drag.lineId]?.mapBendPoints);
    await saveMapLineBendPoints(drag.lineId, bendPoints, 'Line bend saved.', { undoSnapshot: drag.undoSnapshot });
  }

  function markerDraftFromPoint(node, point) {
    const coordinates = mapScreenPointToGeo(point.x, point.y);
    if (!coordinates) return null;
    return {
      nodeId: node.id,
      sourceId: node.sourceId,
      type: node.type,
      label: node.label,
      x: point.x,
      y: point.y,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    };
  }

  function setMapMarkerDraftFromPoint(node, point) {
    const draft = markerDraftFromPoint(node, point);
    if (!draft) return;
    mapMarkerDraftRef.current = draft;
    setMapMarkerDraft(draft);
  }

  function startMapMarkerDrag(event, node) {
    event.stopPropagation();
    if (!mapEditMode || event.button !== 0 || mapSavingMarkerId) return;
    event.preventDefault();
    const point = mapSurfacePointFromEvent(event);
    if (!point) return;
    mapMarkerDragRef.current = { nodeId: node.id, node };
    setMapMarkerSaveError('');
    setMapDragging(false);
    setMapMarkerDraftFromPoint(node, point);
  }

  function focusMapNode(event, node) {
    event.stopPropagation();
    if (!node || mapEditMode || mapLineEditMode) return;
    setMapFocusedNodeId(node.id);
    setMapLayerVisibility((current) => ({ ...normalizeMapLayerVisibility(current), links: true }));
    setMapSelectedLineId('');
    setMapLinePopover(null);
    setMapLineMessage('');
  }

  function clearMapFocus() {
    if (!mapFocusedNodeId) return;
    setMapFocusedNodeId('');
  }

  function mapNodeCoordinatesPatch(type, sourceId, latitude, longitude) {
    const coordinatePatch = {
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6)
    };
    if (type === 'olt') {
      const olt = olts.find((row) => row.id === sourceId);
      if (!olt) return null;
      return {
        path: `/network-settings/olts/${sourceId}`,
        body: {
          name: olt.name,
          site: olt.site || olt.locationName || 'Main POP',
          managementIp: olt.managementIp || '',
          vendor: olt.vendor || 'Generic',
          model: olt.model || '',
          firmwareVersion: olt.firmwareVersion || '',
          status: olt.status || 'ACTIVE',
          defaultPonCount: numberOrBlank(olt.defaultPonCount) || 4,
          notes: olt.notes || '',
          locationId: olt.locationId || '',
          locationName: olt.locationName || olt.site || '',
          ...coordinatePatch
        }
      };
    }
    const nap = napsById.get(sourceId);
    if (!nap) return null;
    return {
      path: `/network-settings/nap-boxes/${sourceId}`,
      body: {
        name: nap.name,
        ponPortId: nap.ponPortId,
        location: '',
        barangay: nap.barangay || '',
        splitterRatio: normalizeNapSplitterRatio(nap.splitterRatio),
        status: nap.status || 'ACTIVE',
        notes: nap.notes || '',
        ...coordinatePatch
      }
    };
  }

  async function saveMapMarkerCoordinates(draft) {
    if (!draft?.sourceId || !Number.isFinite(draft.latitude) || !Number.isFinite(draft.longitude)) return;
    const patch = mapNodeCoordinatesPatch(draft.type, draft.sourceId, draft.latitude, draft.longitude);
    if (!patch) return;
    setMapSavingMarkerId(draft.nodeId);
    setMapMarkerSaveError('');
    try {
      const saved = await request(patch.path, {
        method: 'PATCH',
        body: JSON.stringify(patch.body)
      });
      if (draft.type === 'olt') {
        setOlts((current) => current.map((olt) => (olt.id === saved.id ? { ...olt, ...saved } : olt)));
      } else {
        setNaps((current) => uniqueNapRows([saved, ...current.filter((nap) => nap.id !== saved.id)]));
      }
      const latitude = Number(saved.latitude ?? draft.latitude).toFixed(6);
      const longitude = Number(saved.longitude ?? draft.longitude).toFixed(6);
      setMessage(`${saved.name || draft.label} coordinates saved: ${latitude}, ${longitude}.`);
      Promise.resolve(refreshShell()).catch(() => {});
    } catch (err) {
      setMapMarkerSaveError(err.message);
      setError(err.message);
    } finally {
      setMapSavingMarkerId('');
    }
  }

  function finishMapMarkerDrag() {
    const draft = mapMarkerDraftRef.current;
    mapMarkerDragRef.current = null;
    setMapMarkerDraft(null);
    if (draft) saveMapMarkerCoordinates(draft);
  }

  function startMapPan(event) {
    if (event.button !== 0) return;
    if (mapMarkerDragRef.current) return;
    if (mapLineBendDragRef.current) return;
    if (event.target.closest('.network-map-line-popover, .network-map-link-hit, .network-map-line-handle-wrap, .network-map-line-handle-delete')) return;
    clearMapFocus();
    mapDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: mapView.panX,
      panY: mapView.panY
    };
    setMapDragging(true);
  }

  function moveMapPan(event) {
    if (mapLineBendDragRef.current) return;
    if (mapMarkerDragRef.current) {
      const point = mapSurfacePointFromEvent(event);
      if (point) setMapMarkerDraftFromPoint(mapMarkerDragRef.current.node, point);
      return;
    }
    if (!mapDragRef.current) return;
    const { x, y, panX, panY } = mapDragRef.current;
    setMapView((current) => ({
      ...current,
      panX: panX + event.clientX - x,
      panY: panY + event.clientY - y
    }));
  }

  function endMapPan() {
    if (mapMarkerDragRef.current) {
      finishMapMarkerDrag();
      return;
    }
    mapDragRef.current = null;
    setMapDragging(false);
  }

  function mapImageFor(targetId) {
    return mapImages?.targets?.find((target) => target.id === targetId)?.image?.data_url || '';
  }

  function plcSplitterDisplayFor(assignment = {}) {
    const splitter = assignment.splitter || {};
    const splitterType = normalizeSplitterType(splitter.splitterType);
    if (!['PLC', 'LCP'].includes(splitterType)) return null;
    const ratio = assignment.ratio || splitter.splitRatio || (splitter.outputPorts ? `1:${splitter.outputPorts}` : '');
    const outputPorts = splitterOutputPortsFromRatio(ratio, Number(splitter.outputPorts || splitter.portCapacity || 0));
    if (![4, 8, 16].includes(outputPorts)) return null;
    return {
      outputPorts,
      ratioLabel: `1x${outputPorts}`,
      label: `${splitterType} 1x${outputPorts}`
    };
  }

  function renderPlcSplitterSvg(display, options = {}) {
    if (!display) return null;
    const highlightedPortNumber = Number(options.highlightedPortNumber || 0);
    const outputPorts = [4, 8, 16].includes(display.outputPorts) ? display.outputPorts : 8;
    const twoRows = outputPorts === 16;
    const viewWidth = outputPorts === 4 ? 132 : twoRows ? 186 : 162;
    const viewHeight = twoRows ? 104 : 86;
    const bodyWidth = outputPorts === 4 ? 106 : twoRows ? 158 : 136;
    const bodyX = 12;
    const bodyY = 12;
    const bodyHeight = viewHeight - 24;
    const portColumns = outputPorts === 4 ? 4 : 8;
    const portGap = twoRows ? 5 : 6;
    const portWidth = twoRows ? 9 : 10;
    const portHeight = twoRows ? 12 : 16;
    const portBlockWidth = (portColumns * portWidth) + ((portColumns - 1) * portGap);
    const portStartX = bodyX + (bodyWidth - portBlockWidth) / 2;
    const portRows = twoRows
      ? [bodyY + 32, bodyY + bodyHeight - portHeight - 12]
      : [bodyY + bodyHeight - portHeight - 12];
    const ports = Array.from({ length: outputPorts }, (_, index) => {
      const row = twoRows ? Math.floor(index / portColumns) : 0;
      const column = index % portColumns;
      return {
        id: index + 1,
        x: portStartX + column * (portWidth + portGap),
        y: portRows[row]
      };
    });
    return (
      <svg className="network-fiber-map-plc-svg" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={display.label}>
        <rect className="network-fiber-map-plc-shadow" x={bodyX + 3} y={bodyY + 3} width={bodyWidth + 7} height={bodyHeight} rx="12" />
        <rect className="network-fiber-map-plc-body" x={bodyX} y={bodyY} width={bodyWidth} height={bodyHeight} rx="12" />
        <rect className="network-fiber-map-plc-panel" x={bodyX + 10} y={bodyY + 11} width={bodyWidth - 20} height={bodyHeight - 22} rx="8" />
        <text className="network-fiber-map-plc-ratio-label" x={bodyX + 17} y={bodyY + 22}>{display.ratioLabel}</text>
        {ports.map((port) => (
          <g key={port.id}>
            <rect className={`network-fiber-map-plc-port ${highlightedPortNumber === port.id ? 'mapped' : ''}`} x={port.x} y={port.y} width={portWidth} height={portHeight} rx="2" />
          </g>
        ))}
      </svg>
    );
  }

  function nextFiberMappingWithNode(source, nodeKey, patch) {
    const mapping = normalizeFiberMapping(source);
    return {
      ...mapping,
      nodes: {
        ...mapping.nodes,
        [nodeKey]: {
          ...(mapping.nodes[nodeKey] || {}),
          ...patch
        }
      }
    };
  }

  function nextFiberMappingWithNodes(source, nodePatches) {
    const mapping = normalizeFiberMapping(source);
    return {
      ...mapping,
      nodes: {
        ...mapping.nodes,
        ...Object.fromEntries(
          Object.entries(nodePatches || {}).map(([nodeKey, patch]) => [
            nodeKey,
            {
              ...(mapping.nodes[nodeKey] || {}),
              ...patch
            }
          ])
        )
      }
    };
  }

  function fiberInternalDefaultSplitterPosition(index = 0) {
    return {
      x: 124 + index * 150,
      y: FIBER_INTERNAL_CANVAS.height / 2
    };
  }

  function fiberInternalSplitterPosition(assignment, index = 0) {
    const fallback = fiberInternalDefaultSplitterPosition(index);
    return {
      x: Number.isFinite(Number(assignment?.positionX)) ? Number(assignment.positionX) : fallback.x,
      y: Number.isFinite(Number(assignment?.positionY)) ? Number(assignment.positionY) : fallback.y
    };
  }

  function fiberInternalCanvasMetrics(assignments = [], containerKey = '', options = {}) {
    const positions = assignments.map((assignment, index) => fiberInternalSplitterPosition(assignment, index));
    const mapping = normalizeFiberMapping(fiberMapping);
    const storedPointPositions = [];
    assignments.forEach((assignment) => {
      ['input', 'splitA', 'splitB', 'output'].forEach((terminal) => {
        const point = mapping.connectionPoints?.[fiberMapConnectionPointKey(containerKey, assignment.assignmentId, terminal)];
        if (Number.isFinite(Number(point?.positionX)) && Number.isFinite(Number(point?.positionY))) {
          storedPointPositions.push({ x: Number(point.positionX), y: Number(point.positionY) });
        }
      });
    });
    const allPositions = [...positions, ...storedPointPositions];
    const maxX = allPositions.reduce((largest, position) => Math.max(largest, position.x), 0);
    const maxY = allPositions.reduce((largest, position) => Math.max(largest, position.y), 0);
    const minHeight = options.modal ? FIBER_INTERNAL_CANVAS.height : FIBER_INTERNAL_CANVAS.height;
    const minWidth = options.modal ? FIBER_INTERNAL_CANVAS.modalMinWidth : FIBER_INTERNAL_CANVAS.minWidth;
    return {
      width: Math.max(minWidth, maxX + FIBER_INTERNAL_CANVAS.branchLength + 72),
      height: Math.max(minHeight, maxY + 52),
      positions
    };
  }

  function fiberInternalConnectionPointPosition(containerKey, assignmentId, terminal, fallback) {
    const mapping = normalizeFiberMapping(fiberMapping);
    const point = mapping.connectionPoints?.[fiberMapConnectionPointKey(containerKey, assignmentId, terminal)];
    return {
      x: Number.isFinite(Number(point?.positionX)) ? Number(point.positionX) : fallback.x,
      y: Number.isFinite(Number(point?.positionY)) ? Number(point.positionY) : fallback.y
    };
  }

  function fiberInternalSplitterTypeForAssignment(assignment = {}) {
    const splitter = assignment.splitter || splittersById.get(assignment.splitterId) || {};
    return normalizeSplitterType(splitter.splitterType);
  }

  function fiberInternalInputFallback(position, index, metrics, assignment = {}) {
    const splitterType = fiberInternalSplitterTypeForAssignment(assignment);
    const wideEquipment = ['PLC', 'LCP'].includes(splitterType);
    const inputLength = wideEquipment ? FIBER_INTERNAL_CANVAS.branchLength : 46;
    const minimumX = wideEquipment ? 8 : FIBER_INTERNAL_CANVAS.inputX + 42;
    return {
      x: Math.max(minimumX, position.x - inputLength),
      y: position.y
    };
  }

  function fiberInternalOutputFallbackForTerminal(position, terminal, metrics = null) {
    const raw = {
      x: position.x + FIBER_INTERNAL_CANVAS.branchLength,
      y: terminal === 'splitA'
        ? position.y + FIBER_INTERNAL_CANVAS.outputGap
        : terminal === 'splitB'
          ? position.y - FIBER_INTERNAL_CANVAS.outputGap
          : position.y
    };
    if (!metrics) return raw;
    return {
      x: Math.min(raw.x, metrics.width - 32),
      y: terminal === 'output' ? raw.y : clamp(raw.y, 32, metrics.height - 28)
    };
  }

  function connectionPointPositionOrFallback(point, fallback) {
    return {
      x: Number.isFinite(Number(point?.positionX)) ? Number(point.positionX) : fallback.x,
      y: Number.isFinite(Number(point?.positionY)) ? Number(point.positionY) : fallback.y
    };
  }

  function clearEndpointRoleFromConnectionPoint(connectionPoints, pointKey) {
    const currentPoint = connectionPoints[pointKey];
    if (!currentPoint || !fiberMappingEndpointRole(currentPoint)) return false;
    const { endpointRole, ...remainingPoint } = currentPoint;
    if (Object.keys(remainingPoint).length) connectionPoints[pointKey] = remainingPoint;
    else delete connectionPoints[pointKey];
    return true;
  }

  function repairFiberMappingEndpointRoles(source, splitterMap = splittersById) {
    const mapping = normalizeFiberMapping(source);
    const connectionPoints = { ...mapping.connectionPoints };
    let changed = false;
    Object.keys(mapping.containerSplitterAssignments || {}).forEach((containerKey) => {
      const assignments = containerSplitterAssignments(mapping, containerKey)
        .map((assignment) => ({
          ...assignment,
          splitter: assignment.splitter || splitterMap.get(assignment.splitterId)
        }));
      if (!assignments.length) return;

      const firstAssignment = assignments[0];
      const firstInputKey = fiberMapConnectionPointKey(containerKey, firstAssignment.assignmentId, 'input');
      const inputEntries = Object.entries(connectionPoints)
        .filter(([pointKey, point]) => pointKey.startsWith(`${containerKey}|`) && fiberMappingEndpointRole(point) === 'input');
      if (inputEntries.length && (inputEntries.length > 1 || inputEntries[0][0] !== firstInputKey)) {
        inputEntries.forEach(([pointKey]) => {
          if (clearEndpointRoleFromConnectionPoint(connectionPoints, pointKey)) changed = true;
        });
        const position = fiberInternalSplitterPosition(firstAssignment, 0);
        const fallback = fiberInternalInputFallback(position, 0, null, firstAssignment);
        const point = connectionPointPositionOrFallback(connectionPoints[firstInputKey], fallback);
        connectionPoints[firstInputKey] = {
          ...(connectionPoints[firstInputKey] || {}),
          positionX: Math.round(point.x),
          positionY: Math.round(point.y),
          endpointRole: 'input'
        };
        changed = true;
      }

      const lastAssignment = assignments[assignments.length - 1];
      const lastTerminal = fiberMappingOutTerminalForAssignment(lastAssignment, splitterMap);
      const lastOutputKey = fiberMapConnectionPointKey(containerKey, lastAssignment.assignmentId, lastTerminal);
      const outputEntries = Object.entries(connectionPoints)
        .filter(([pointKey, point]) => pointKey.startsWith(`${containerKey}|`) && fiberMappingEndpointRole(point) === 'output');
      if (outputEntries.length && (outputEntries.length > 1 || outputEntries[0][0] !== lastOutputKey)) {
        outputEntries.forEach(([pointKey]) => {
          if (clearEndpointRoleFromConnectionPoint(connectionPoints, pointKey)) changed = true;
        });
        const position = fiberInternalSplitterPosition(lastAssignment, assignments.length - 1);
        const fallback = fiberInternalOutputFallbackForTerminal(position, lastTerminal);
        const point = connectionPointPositionOrFallback(connectionPoints[lastOutputKey], fallback);
        connectionPoints[lastOutputKey] = {
          ...(connectionPoints[lastOutputKey] || {}),
          positionX: Math.round(point.x),
          positionY: Math.round(point.y),
          endpointRole: 'output'
        };
        changed = true;
      }
    });
    return changed ? { ...mapping, connectionPoints } : mapping;
  }

  function fiberContainerEndpointPoint(metrics, endpoint) {
    return {
      x: endpoint === 'input' ? 0 : metrics.width,
      y: metrics.height / 2
    };
  }

  function nextFiberMappingWithSplitterPosition(source, containerKey, assignmentId, position) {
    const mapping = normalizeFiberMapping(source);
    const assignments = containerSplitterAssignments(mapping, containerKey);
    return {
      ...mapping,
      containerSplitterAssignments: {
        ...mapping.containerSplitterAssignments,
        [containerKey]: assignments.map((assignment) => (
          assignment.assignmentId === assignmentId
            ? {
              ...assignment,
              positionX: Math.round(position.x),
              positionY: Math.round(position.y)
            }
            : assignment
        ))
      }
    };
  }

  function nextFiberMappingWithConnectionPointPosition(source, containerKey, assignmentId, terminal, position) {
    const mapping = normalizeFiberMapping(source);
    const pointKey = fiberMapConnectionPointKey(containerKey, assignmentId, terminal);
    return {
      ...mapping,
      connectionPoints: {
        ...mapping.connectionPoints,
        [pointKey]: {
          ...(mapping.connectionPoints?.[pointKey] || {}),
          positionX: Math.round(position.x),
          positionY: Math.round(position.y)
        }
      }
    };
  }

  function fiberInternalCurvePath(start, end) {
    const distance = Math.max(Math.abs(end.x - start.x), 80);
    const control = Math.max(44, distance * 0.42);
    return `M ${start.x} ${start.y} C ${start.x + control} ${start.y}, ${end.x - control} ${end.y}, ${end.x} ${end.y}`;
  }

  function pushFiberMappingUndo(snapshot, nextSnapshot = fiberMapping) {
    const normalized = normalizeFiberMapping(snapshot);
    const next = normalizeFiberMapping(nextSnapshot);
    if (JSON.stringify(normalized) === JSON.stringify(next)) return;
    const stack = [...fiberMappingUndoStackRef.current, normalized].slice(-40);
    fiberMappingUndoStackRef.current = stack;
    setFiberMappingUndoDepth(stack.length);
  }

  function performFiberMappingUndo() {
    if (fiberMappingSaving) return;
    const previous = fiberMappingUndoStackRef.current.pop();
    fiberMappingUndoStackRef.current = fiberMappingUndoStackRef.current.slice();
    setFiberMappingUndoDepth(fiberMappingUndoStackRef.current.length);
    if (!previous) {
      setMessage('Nothing to undo.');
      return;
    }
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectionBox(null);
    saveFiberMapping(previous, 'Fiber mapping undone.', { skipUndo: true });
  }

  function buildOrganizedFiberMapping(source = fiberMapping, options = {}) {
    const { resetAddedMapping = false } = options;
    const mapping = normalizeFiberMapping(source);
    const nextNodes = {};
    const mappedNapIds = resetAddedMapping
      ? new Set()
      : new Set(
        Object.keys(mapping.nodes || {})
          .filter((key) => key.startsWith('nap:'))
          .map((key) => key.slice(4))
          .filter((napId) => napsById.has(napId))
      );
    let layoutY = FIBER_MAPPING_GROUP_TOP;
    const rowGap = 64;
    const childGap = 54;
    const horizontalGap = 340;
    const columns = {
      olt: 90,
      pon: 430
    };
    const nodePatch = (key, x, y, currentNode = {}, extra = {}) => ({
      ...(currentNode || {}),
      ...extra,
      x: Math.round(x),
      y: Math.round(y),
      visible: true
    });
    const entriesByKey = new Map();
    const childrenBySource = new Map();
    const orphanEntries = [];
    const addEntry = (entry) => {
      if (!entry?.key) return;
      entriesByKey.set(entry.key, entry);
    };
    const addChild = (sourceKey, entry) => {
      if (!sourceKey || !entry?.key) return;
      const current = childrenBySource.get(sourceKey) || [];
      current.push(entry);
      childrenBySource.set(sourceKey, current);
    };
    const entrySize = (entry) => {
      if (entry?.type === 'olt') return FIBER_MAPPING_NODE_SIZE.olt;
      if (entry?.type === 'pon') return FIBER_MAPPING_NODE_SIZE.pon;
      if (entry?.type === 'junction') return FIBER_MAPPING_NODE_SIZE.junction;
      return FIBER_MAPPING_NODE_SIZE.nap;
    };
    const validSourceKey = (entry, sourceKey) => {
      if (!entry?.key || !sourceKey || sourceKey === entry.key || !entriesByKey.has(sourceKey)) return false;
      const sourceEntry = entriesByKey.get(sourceKey);
      if (entry.ponId && sourceEntry?.ponId && entry.ponId !== sourceEntry.ponId) return false;
      return true;
    };

    olts.forEach((olt) => addEntry({
      key: fiberMapNodeKey('olt', olt.id),
      type: 'olt',
      id: olt.id,
      oltId: olt.id,
      label: olt.name
    }));
    pons.forEach((pon) => addEntry({
      key: fiberMapNodeKey('pon', pon.id),
      type: 'pon',
      id: pon.id,
      ponId: pon.id,
      oltId: pon.oltId,
      label: canonicalPonLabel(pon)
    }));
    const napEntries = naps
      .filter((nap) => mappedNapIds.has(nap.id))
      .map((nap) => ({
        key: fiberMapNodeKey('nap', nap.id),
        type: 'nap',
        id: nap.id,
        nap,
        ponId: nap.ponPortId,
        oltId: nap.oltId,
        label: nap.name
      }));
    napEntries.forEach(addEntry);
    const junctionEntries = resetAddedMapping
      ? []
      : Object.values(mapping.junctionBoxes || {})
        .filter((junction) => junction?.id)
        .map((junction) => ({
          key: fiberMapNodeKey('junction', junction.id),
          type: 'junction',
          id: junction.id,
          junction,
          ponId: junction.ponId,
          oltId: junction.oltId,
          label: junction.name || 'Junction Box',
          storedSourceKey: junction.sourceKey
        }));
    junctionEntries.forEach(addEntry);
    napEntries.forEach((entry) => {
      const ponKey = fiberMapNodeKey('pon', entry.ponId);
      const storedSourceKey = mapping.nodes?.[entry.key]?.sourceKey;
      const sourceKey = validSourceKey(entry, storedSourceKey)
        ? storedSourceKey
        : validSourceKey(entry, ponKey)
          ? ponKey
          : '';
      entry.sourceKey = sourceKey;
      if (sourceKey) addChild(sourceKey, entry);
      else orphanEntries.push(entry);
    });
    junctionEntries.forEach((entry) => {
      const fallbackPonKey = entry.ponId ? fiberMapNodeKey('pon', entry.ponId) : '';
      const sourceKey = validSourceKey(entry, entry.storedSourceKey)
        ? entry.storedSourceKey
        : validSourceKey(entry, fallbackPonKey)
          ? fallbackPonKey
          : '';
      entry.sourceKey = sourceKey;
      if (sourceKey) addChild(sourceKey, entry);
      else orphanEntries.push(entry);
    });
    childrenBySource.forEach((children, sourceKey) => {
      childrenBySource.set(sourceKey, [...children].sort((left, right) => (
        left.type.localeCompare(right.type)
        || String(left.label || '').localeCompare(String(right.label || ''))
      )));
    });

    const subtreeHeight = (entry, seen = new Set()) => {
      if (!entry?.key || seen.has(entry.key)) return 0;
      const nextSeen = new Set([...seen, entry.key]);
      const children = (childrenBySource.get(entry.key) || []).filter((child) => !nextSeen.has(child.key));
      const ownHeight = entrySize(entry).height;
      if (!children.length) return ownHeight;
      const childrenHeight = children.reduce((total, child, index) => (
        total + subtreeHeight(child, nextSeen) + (index ? childGap : 0)
      ), 0);
      return Math.max(ownHeight, childrenHeight);
    };
    const placeChildren = (sourceEntry, x, top, height, seen = new Set()) => {
      if (!sourceEntry?.key || seen.has(sourceEntry.key)) return;
      const nextSeen = new Set([...seen, sourceEntry.key]);
      const children = (childrenBySource.get(sourceEntry.key) || []).filter((child) => !nextSeen.has(child.key));
      if (!children.length) return;
      const childHeights = children.map((child) => subtreeHeight(child, nextSeen));
      const stackHeight = childHeights.reduce((total, childHeight, index) => total + childHeight + (index ? childGap : 0), 0);
      let childY = top + Math.max(0, (height - stackHeight) / 2);
      children.forEach((child, index) => {
        const childHeight = childHeights[index];
        const size = entrySize(child);
        const y = childY + Math.max(0, (childHeight - size.height) / 2);
        nextNodes[child.key] = nodePatch(child.key, x, y, mapping.nodes[child.key], {
          sourceKey: child.sourceKey
        });
        placeChildren(child, x + horizontalGap, childY, childHeight, nextSeen);
        childY += childHeight + childGap;
      });
    };

    olts.forEach((olt) => {
      const oltKey = fiberMapNodeKey('olt', olt.id);
      const oltPons = pons
        .filter((pon) => pon.oltId === olt.id)
        .sort((left, right) => Number(left.portNumber || 0) - Number(right.portNumber || 0));
      const ponRows = oltPons.map((pon) => {
        const ponEntry = entriesByKey.get(fiberMapNodeKey('pon', pon.id));
        return {
          pon,
          entry: ponEntry,
          height: subtreeHeight(ponEntry)
        };
      });
      const rowsHeight = ponRows.length
        ? ponRows.reduce((total, row) => total + row.height, 0) + ((ponRows.length - 1) * rowGap)
        : FIBER_MAPPING_NODE_SIZE.pon.height;
      const groupHeight = Math.max(FIBER_MAPPING_NODE_SIZE.olt.height, rowsHeight);
      nextNodes[oltKey] = nodePatch(
        oltKey,
        columns.olt,
        layoutY + (groupHeight - FIBER_MAPPING_NODE_SIZE.olt.height) / 2,
        mapping.nodes[oltKey]
      );

      let rowY = layoutY + (groupHeight - rowsHeight) / 2;
      ponRows.forEach((row) => {
        const ponKey = fiberMapNodeKey('pon', row.pon.id);
        nextNodes[ponKey] = nodePatch(
          ponKey,
          columns.pon,
          rowY + (row.height - FIBER_MAPPING_NODE_SIZE.pon.height) / 2,
          mapping.nodes[ponKey]
        );
        placeChildren(row.entry, columns.pon + horizontalGap, rowY, row.height);
        rowY += row.height + rowGap;
      });
      layoutY += groupHeight + FIBER_MAPPING_OLT_GAP;
    });

    orphanEntries.forEach((entry, index) => {
      const size = entrySize(entry);
      nextNodes[entry.key] = nodePatch(
        entry.key,
        columns.pon + horizontalGap,
        layoutY + index * (size.height + childGap),
        mapping.nodes[entry.key],
        entry.sourceKey ? { sourceKey: entry.sourceKey } : {}
      );
    });

    const organizedNodes = Object.entries(nextNodes).map(([key, node]) => {
      const entry = entriesByKey.get(key) || {};
      const size = entrySize(entry);
      return {
        key,
        ...node,
        width: size.width,
        height: size.height,
        type: entry.type || key.split(':')[0],
        sourceKey: node.sourceKey || entry.sourceKey || '',
        oltId: entry.oltId || '',
        ponId: entry.ponId || ''
      };
    });
    const overlapPatches = fiberMappingResolveNodeOverlaps(organizedNodes);
    Object.entries(overlapPatches).forEach(([key, patch]) => {
      nextNodes[key] = {
        ...nextNodes[key],
        ...patch
      };
    });

    return {
      ...mapping,
      nodes: nextNodes,
      edges: resetAddedMapping ? {} : { ...mapping.edges },
      napSplitters: resetAddedMapping ? {} : { ...mapping.napSplitters },
      junctionBoxes: resetAddedMapping ? {} : { ...mapping.junctionBoxes },
      containerSplitters: resetAddedMapping ? {} : { ...mapping.containerSplitters },
      containerSplitterAssignments: resetAddedMapping ? {} : { ...mapping.containerSplitterAssignments },
      connectionPoints: resetAddedMapping ? {} : { ...mapping.connectionPoints }
    };
  }

  function clampFiberMappingPan(panX, panY, zoomValue = fiberMappingView.zoom) {
    const rect = fiberMappingSurfaceRef.current?.getBoundingClientRect();
    const surfaceWidth = rect?.width || 1200;
    const surfaceHeight = rect?.height || 720;
    const zoom = clamp(Number(zoomValue) || 1, 0.45, 1.8);
    const panSlackX = Math.max(320, surfaceWidth);
    const panSlackY = Math.max(320, surfaceHeight);
    const minPanX = Math.min(panSlackX, surfaceWidth - fiberMappingCanvas.canvas.width * zoom - panSlackX);
    const minPanY = Math.min(panSlackY, surfaceHeight - fiberMappingCanvas.canvas.height * zoom - panSlackY);
    return {
      panX: clamp(Math.round(panX), minPanX, panSlackX),
      panY: clamp(Math.round(panY), minPanY, panSlackY)
    };
  }

  function resetFiberMappingViewportToOrigin() {
    setFiberMappingView({ zoom: 1, panX: 0, panY: 0 });
  }

  function resetFiberMappingView() {
    const firstOltNode = fiberMappingCanvas.nodes.find((node) => node.type === 'olt');
    if (!firstOltNode) {
      resetFiberMappingViewportToOrigin();
      return;
    }
    const zoom = 1;
    const viewportPadding = 24;
    const next = clampFiberMappingPan(
      viewportPadding - firstOltNode.x * zoom,
      viewportPadding - firstOltNode.y * zoom,
      zoom
    );
    setFiberMappingView({ zoom, ...next });
  }

  function fiberMappingSurfacePoint(event) {
    const rect = fiberMappingSurfaceRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0)
    };
  }

  function makeFiberMappingSelectionBox(startPoint, endPoint) {
    return {
      left: Math.min(startPoint.x, endPoint.x),
      top: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y)
    };
  }

  function selectedFiberMappingKeysForBox(box) {
    const zoom = Number(fiberMappingView.zoom) || 1;
    const x1 = (box.left - fiberMappingView.panX) / zoom;
    const y1 = (box.top - fiberMappingView.panY) / zoom;
    const x2 = (box.left + box.width - fiberMappingView.panX) / zoom;
    const y2 = (box.top + box.height - fiberMappingView.panY) / zoom;
    return fiberMappingCanvas.nodes
      .filter((node) => (
        node.x < x2
        && node.x + node.width > x1
        && node.y < y2
        && node.y + node.height > y1
      ))
      .map((node) => node.key);
  }

  function startFiberMappingPan(event) {
    const wantsPan = event.ctrlKey || event.metaKey || fiberMappingCtrlPressed || event.button === 1 || event.button === 2;
    if (event.target.closest('.network-fiber-map-nap-menu, button, input, select, textarea, a')) return;
    setFiberMappingNapMenuPonId('');
    if (event.target.closest('.network-fiber-map-node') && !wantsPan) return;
    if (![0, 1, 2].includes(event.button)) return;
    setFiberMappingSelectionBox(null);
    fiberMappingPanRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: fiberMappingView.panX,
      panY: fiberMappingView.panY
    };
    setFiberMappingPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFiberMappingPan(event) {
    const pan = fiberMappingPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const next = clampFiberMappingPan(
      pan.panX + event.clientX - pan.clientX,
      pan.panY + event.clientY - pan.clientY,
      fiberMappingView.zoom
    );
    setFiberMappingView((current) => ({ ...current, ...next }));
  }

  function endFiberMappingPan(event) {
    const pan = fiberMappingPanRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    fiberMappingPanRef.current = null;
    setFiberMappingPanning(false);
  }

  function zoomFiberMapping(multiplier, anchorClientX = null, anchorClientY = null) {
    setFiberMappingView((current) => {
      const nextZoom = clamp(Number(((Number(current.zoom) || 1) * multiplier).toFixed(3)), 0.45, 1.8);
      if (nextZoom === current.zoom) return current;
      const rect = fiberMappingSurfaceRef.current?.getBoundingClientRect();
      const anchorX = rect && anchorClientX !== null ? anchorClientX - rect.left : (rect?.width || 1200) / 2;
      const anchorY = rect && anchorClientY !== null ? anchorClientY - rect.top : (rect?.height || 720) / 2;
      const ratio = nextZoom / (Number(current.zoom) || 1);
      const nextPanX = anchorX - (anchorX - current.panX) * ratio;
      const nextPanY = anchorY - (anchorY - current.panY) * ratio;
      const clamped = clampFiberMappingPan(nextPanX, nextPanY, nextZoom);
      return { zoom: nextZoom, ...clamped };
    });
  }

  function resetFiberLayoutModalView() {
    setFiberLayoutModalView({ zoom: 1, panX: 32, panY: 32, panning: false });
    fiberLayoutModalPanRef.current = null;
  }

  function zoomFiberLayoutModal(multiplier, anchorClientX = null, anchorClientY = null) {
    setFiberLayoutModalView((current) => {
      const nextZoom = clamp(Number(((Number(current.zoom) || 1) * multiplier).toFixed(3)), 0.5, 2.25);
      if (nextZoom === current.zoom) return current;
      const rect = fiberLayoutModalSurfaceRef.current?.getBoundingClientRect();
      const anchorX = rect && anchorClientX !== null ? anchorClientX - rect.left : (rect?.width || 960) / 2;
      const anchorY = rect && anchorClientY !== null ? anchorClientY - rect.top : (rect?.height || 520) / 2;
      const ratio = nextZoom / (Number(current.zoom) || 1);
      return {
        ...current,
        zoom: nextZoom,
        panX: anchorX - (anchorX - current.panX) * ratio,
        panY: anchorY - (anchorY - current.panY) * ratio
      };
    });
  }

  function wheelFiberLayoutModal(event) {
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    zoomFiberLayoutModal(event.deltaY < 0 ? 1.1 : 0.9, event.clientX, event.clientY);
  }

  function startFiberLayoutModalPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a, .network-fiber-map-internal-point, .network-fiber-map-internal-splitter-wrap, .network-fiber-map-connection-wrap, .network-fiber-map-internal-canvas-hit')) return;
    event.preventDefault();
    fiberLayoutModalPanRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: fiberLayoutModalView.panX,
      panY: fiberLayoutModalView.panY
    };
    setFiberLayoutModalView((current) => ({ ...current, panning: true }));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFiberLayoutModalPan(event) {
    const pan = fiberLayoutModalPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    setFiberLayoutModalView((current) => ({
      ...current,
      panX: pan.panX + event.clientX - pan.clientX,
      panY: pan.panY + event.clientY - pan.clientY
    }));
  }

  function endFiberLayoutModalPan(event) {
    const pan = fiberLayoutModalPanRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    fiberLayoutModalPanRef.current = null;
    setFiberLayoutModalView((current) => ({ ...current, panning: false }));
  }

  function fiberInternalDragScale(event) {
    const zoom = Number(event.currentTarget?.closest?.('[data-fiber-layout-zoom]')?.dataset?.fiberLayoutZoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  function wheelFiberMapping(event) {
    if (event.target instanceof Element && event.target.closest('.network-fiber-map-nap-menu, button, input, select, textarea, a')) return;
    event.preventDefault();
    zoomFiberMapping(event.deltaY < 0 ? 1.1 : 0.9, event.clientX, event.clientY);
  }

  async function saveFiberMapping(nextMapping, successMessage = '', options = {}) {
    const normalized = repairFiberMappingEndpointRoles(nextMapping);
    if (!options.skipUndo) pushFiberMappingUndo(options.undoSnapshot || fiberMapping, normalized);
    fiberMappingRef.current = normalized;
    setFiberMapping(normalized);
    setFiberMappingSaving(true);
    setError('');
    try {
      const saved = await request('/network-settings/fiber-mapping', {
        method: 'PATCH',
        body: JSON.stringify(normalized)
      });
      const savedMapping = normalizeFiberMapping(saved);
      fiberMappingRef.current = savedMapping;
      setFiberMapping(savedMapping);
      if (successMessage) setMessage(successMessage);
      refreshShell();
    } catch (err) {
      setError(err.message);
    } finally {
      setFiberMappingSaving(false);
    }
  }

  function updateFiberMappingNode(nodeKey, patch, persist = true) {
    const next = nextFiberMappingWithNode(fiberMapping, nodeKey, patch);
    setFiberMapping(next);
    if (persist) saveFiberMapping(next);
  }

  function updateFiberLineForm(field, value) {
    setFiberLineForm((current) => ({ ...current, [field]: value }));
    setFiberLineFormError('');
  }

  function resetPonFiberLinkCanvasView() {
    fiberLinkCanvasPanRef.current = null;
    setFiberLinkCanvasView({ zoom: 1, panX: 32, panY: 32, panning: false });
  }

  function zoomPonFiberLinkCanvas(multiplier) {
    setFiberLinkCanvasView((current) => ({
      ...current,
      zoom: clamp(Number(((Number(current.zoom) || 1) * multiplier).toFixed(3)), 0.55, 2.4)
    }));
  }

  function startPonFiberLinkCanvasPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a, .network-pon-fiber-link-hit, .network-pon-fiber-link-indicator, .network-pon-fiber-link-connector-button')) return;
    event.preventDefault();
    fiberLinkCanvasPanRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: fiberLinkCanvasView.panX,
      panY: fiberLinkCanvasView.panY
    };
    setFiberLinkCanvasView((current) => ({ ...current, panning: true }));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePonFiberLinkCanvasPan(event) {
    const pan = fiberLinkCanvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    setFiberLinkCanvasView((current) => ({
      ...current,
      panX: pan.panX + event.clientX - pan.clientX,
      panY: pan.panY + event.clientY - pan.clientY
    }));
  }

  function endPonFiberLinkCanvasPan(event) {
    const pan = fiberLinkCanvasPanRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    fiberLinkCanvasPanRef.current = null;
    setFiberLinkCanvasView((current) => ({ ...current, panning: false }));
  }

  function openPonFiberLinkCanvas(ponId) {
    if (!ponId) return;
    setFiberLinkCanvasPonId(ponId);
    setFiberMappingSelectedEdgeId('');
    setFiberLineReturnPonId('');
    setFiberLinkSettingsReturnPonId('');
    setFiberLineFormError('');
    setMessage('');
    setError('');
    setFiberMappingNapMenuPonId('');
    resetPonFiberLinkCanvasView();
    setModalType('pon-fiber-link');
  }

  function openFiberLinkSettingsModal(options = {}) {
    setFiberLinkSettingsForm(normalizeFiberLinkSettings(fiberMapping?.fiberLinkSettings));
    setFiberLinkSettingsError('');
    setFiberLinkSettingsReturnPonId(options.returnPonId || '');
    setModalType('fiber-link-settings');
  }

  function closeFiberLinkSettingsModal() {
    if (fiberLinkSettingsReturnPonId) {
      setFiberLinkSettingsError('');
      setFiberLinkSettingsReturnPonId('');
      setModalType('pon-fiber-link');
      return;
    }
    closeModal();
  }

  async function saveFiberLinkSettings(event) {
    event.preventDefault();
    setFiberLinkSettingsError('');
    const nextSettings = normalizeFiberLinkSettings(fiberLinkSettingsForm);
    if (nextSettings.minLinePixels > nextSettings.maxLinePixels) {
      setFiberLinkSettingsError('Minimum line size must be less than or equal to maximum line size.');
      return;
    }
    const mapping = normalizeFiberMapping(fiberMapping);
    await saveFiberMapping(
      {
        ...mapping,
        fiberLinkSettings: nextSettings
      },
      'Topology fiber link settings saved.'
    );
  }

  async function cyclePonFiberLineConnection(edge) {
    if (!edge?.id) return;
    const mapping = normalizeFiberMapping(fiberMapping);
    const currentValue = String(mapping.edges?.[edge.id]?.connectionType || edge.config?.connectionType || 'FUSION').toUpperCase();
    const currentIndex = FIBER_CONNECTION_TYPES.findIndex((item) => item.value === currentValue);
    const nextType = FIBER_CONNECTION_TYPES[(currentIndex + 1) % FIBER_CONNECTION_TYPES.length];
    let nextMapping = {
      ...mapping,
      edges: {
        ...mapping.edges,
        [edge.id]: {
          ...defaultFiberEdgeConfig(),
          ...(mapping.edges?.[edge.id] || {}),
          connectionType: nextType.value
        }
      }
    };
    nextMapping = syncFirstSplitterInputConnector(nextMapping, edge.toKey, nextType.value);
    await saveFiberMapping(nextMapping, `${nextType.label} connector set.`);
  }

  function syncFirstSplitterInputConnector(mappingSource, containerKey, connectionType) {
    if (!containerKey || !['nap:', 'junction:'].some((prefix) => containerKey.startsWith(prefix))) return mappingSource;
    const mapping = normalizeFiberMapping(mappingSource);
    const [firstAssignment] = containerSplitterAssignments(mapping, containerKey);
    if (!firstAssignment?.assignmentId) return mapping;
    const pointKey = fiberMapConnectionPointKey(containerKey, firstAssignment.assignmentId, 'input');
    const nextType = FIBER_CONNECTION_TYPES.find((item) => item.value === String(connectionType || '').toUpperCase()) || FIBER_CONNECTION_TYPES[0];
    return {
      ...mapping,
      connectionPoints: {
        ...mapping.connectionPoints,
        [pointKey]: {
          ...(mapping.connectionPoints?.[pointKey] || {}),
          connectionType: nextType.value,
          label: nextType.label,
          updatedAt: new Date().toISOString()
        }
      }
    };
  }

  function syncIncomingFiberEdgeConnector(mappingSource, containerKey, assignmentId, terminal, connectionType) {
    if (terminal !== 'input' || !containerKey || !assignmentId) return mappingSource;
    const mapping = normalizeFiberMapping(mappingSource);
    const [firstAssignment] = containerSplitterAssignments(mapping, containerKey);
    if (firstAssignment?.assignmentId !== assignmentId) return mapping;
    const incomingEdge = fiberMappingCanvas.edges.find((edge) => edge.toKey === containerKey);
    if (!incomingEdge?.id) return mapping;
    const nextType = FIBER_CONNECTION_TYPES.find((item) => item.value === String(connectionType || '').toUpperCase()) || FIBER_CONNECTION_TYPES[0];
    return {
      ...mapping,
      edges: {
        ...mapping.edges,
        [incomingEdge.id]: {
          ...defaultFiberEdgeConfig(),
          ...(mapping.edges?.[incomingEdge.id] || {}),
          connectionType: nextType.value
        }
      }
    };
  }

  function openFiberLineModal(edge, options = {}) {
    if (!edge?.id) return;
    setFiberMappingSelectedEdgeId(edge.id);
    setFiberLineForm({ ...defaultFiberEdgeConfig(), ...(edge.config || {}) });
    setFiberLineReturnPonId(options.returnPonId || '');
    setFiberLineFormError('');
    setMessage('');
    setError('');
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingSelectionBox(null);
    setFiberMappingNapMenuPonId('');
    setModalType('fiber-line');
  }

  function closeFiberLineModal() {
    if (fiberLineReturnPonId) {
      setFiberMappingSelectedEdgeId('');
      setFiberLineFormError('');
      setFiberLineReturnPonId('');
      setModalType('pon-fiber-link');
      return;
    }
    closeModal();
  }

  function validateFiberLineForm() {
    if (!selectedFiberMappingEdge) return 'Choose a fiber line first.';
    if (!fiberLineForm.fiberOpticLossId) return 'Choose a Fiber Optic profile before saving this line.';
    if (!fiberOptics.some((profile) => profile.id === fiberLineForm.fiberOpticLossId)) return 'The selected Fiber Optic profile is no longer available.';
    const numericFields = [
      ['lengthKm', 'Length'],
      ['sourcePowerDbm', 'Source power'],
      ['connectorLossDb', 'Connector loss'],
      ['spliceLossDb', 'Splice loss']
    ];
    const invalid = numericFields.find(([field]) => {
      const value = String(fiberLineForm[field] ?? '').trim();
      return value && cleanNumber(value) === null;
    });
    return invalid ? `${invalid[1]} must be a valid number.` : '';
  }

  async function saveFiberLine(event) {
    event.preventDefault();
    setFiberLineFormError('');
    const validationError = validateFiberLineForm();
    if (validationError) {
      setFiberLineFormError(validationError);
      return;
    }
    const mapping = normalizeFiberMapping(fiberMapping);
    const existingConfig = mapping.edges?.[selectedFiberMappingEdge.id] || selectedFiberMappingEdge.config || {};
    const selectedProfile = fiberOptics.find((profile) => profile.id === fiberLineForm.fiberOpticLossId);
    const fiberCoreNumber = String(fiberCoreNumberForConfig(fiberLineForm, selectedProfile));
    const config = {
      ...defaultFiberEdgeConfig(),
      ...existingConfig,
      ...fiberLineForm,
      wavelengthNm: fiberLineForm.wavelengthNm || defaultMeta.wavelengthsNm[0],
      fiberCoreNumber,
      connectionType: existingConfig.connectionType || selectedFiberMappingEdge.config?.connectionType || 'FUSION',
      lineColor: fiberLineColorForConfig({ ...fiberLineForm, fiberCoreNumber }, selectedProfile)
    };
    const next = {
      ...mapping,
      edges: {
        ...mapping.edges,
        [selectedFiberMappingEdge.id]: config
      }
    };
    await saveFiberMapping(next, 'Fiber link assigned.');
  }

  async function clearFiberLineAssignment() {
    if (!selectedFiberMappingEdge) return;
    const mapping = normalizeFiberMapping(fiberMapping);
    const edges = { ...mapping.edges };
    const existingBendPoints = normalizeMapBendPoints(edges[selectedFiberMappingEdge.id]?.mapBendPoints);
    if (existingBendPoints.length) {
      edges[selectedFiberMappingEdge.id] = {
        ...defaultFiberEdgeConfig(),
        mapBendPoints: existingBendPoints
      };
    } else {
      delete edges[selectedFiberMappingEdge.id];
    }
    setFiberLineForm(defaultFiberEdgeConfig());
    setFiberLineFormError('');
    await saveFiberMapping({ ...mapping, edges }, 'Fiber link assignment cleared.');
  }

  function startFiberMappingNodeDrag(event, node) {
    if (event.ctrlKey || event.metaKey || fiberMappingCtrlPressed) return;
    event.stopPropagation();
    if (event.button !== 0 || node.locked) return;
    if (event.target.closest('button, select, input, textarea, a')) return;
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    const selectedKeys = fiberMappingSelectedNodeKeys.includes(node.key) ? fiberMappingSelectedNodeKeys : [node.key];
    const nodesByKey = new Map(fiberMappingCanvas.nodes.map((canvasNode) => [canvasNode.key, canvasNode]));
    const dragNodes = selectedKeys
      .map((nodeKey) => nodesByKey.get(nodeKey))
      .filter((canvasNode) => canvasNode && !canvasNode.locked);
    if (!dragNodes.length) return;
    if (!fiberMappingSelectedNodeKeys.includes(node.key)) setFiberMappingSelectedNodeKeys([node.key]);
    fiberMappingDragRef.current = {
      nodeKey: node.key,
      nodeKeys: dragNodes.map((canvasNode) => canvasNode.key),
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      baseNodes: Object.fromEntries(dragNodes.map((canvasNode) => [canvasNode.key, {
        x: canvasNode.x,
        y: canvasNode.y,
        ...fiberMappingNodeVisualSize(canvasNode, fiberMappingExpandedContainerKeys)
      }])),
      positions: Object.fromEntries(dragNodes.map((canvasNode) => [canvasNode.key, {
        x: canvasNode.x,
        y: canvasNode.y
      }])),
      moved: false,
      undoSnapshot: normalizeFiberMapping(fiberMapping)
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFiberMappingNode(event) {
    const drag = fiberMappingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const zoom = Number(fiberMappingView.zoom) || 1;
    const deltaX = (event.clientX - drag.clientX) / zoom;
    const deltaY = (event.clientY - drag.clientY) / zoom;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
    const patches = {};
    Object.entries(drag.baseNodes).forEach(([nodeKey, base]) => {
      const maxX = Math.max(FIBER_MAPPING_CANVAS.width, fiberMappingCanvas.canvas.width + 1200);
      const maxY = Math.max(FIBER_MAPPING_CANVAS.height, fiberMappingCanvas.canvas.height + 800);
      const nextX = clamp(base.x + deltaX, 20, maxX - base.width - 20);
      const nextY = clamp(base.y + deltaY, 20, maxY - base.height - 20);
      patches[nodeKey] = {
        x: Math.round(nextX),
        y: Math.round(nextY)
      };
    });
    const candidateNodes = fiberMappingNodesWithPatches(fiberMappingCanvas.nodes, patches);
    const overlapPatches = fiberMappingResolveNodeOverlaps(candidateNodes, fiberMappingExpandedContainerKeys, {
      protectedKeys: drag.nodeKeys
    });
    const nextPatches = {
      ...patches,
      ...overlapPatches
    };
    drag.positions = nextPatches;
    setFiberMapping((current) => nextFiberMappingWithNodes(current, nextPatches));
  }

  function endFiberMappingNodeDrag(event) {
    const drag = fiberMappingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    fiberMappingDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    fiberMappingNodeSuppressClickRef.current = drag.moved;
    if (drag.moved) {
      const next = nextFiberMappingWithNodes(fiberMapping, drag.positions);
      saveFiberMapping(next, '', { undoSnapshot: drag.undoSnapshot });
    }
  }

  function openFiberMappingLayoutModal(node, options = {}) {
    if (!node?.key || !['nap', 'junction'].includes(node.type)) return;
    setFiberMappingLayoutContainerKey(node.key);
    setFiberLayoutReturnPonId(options.returnPonId || '');
    setFiberLayoutIncomingEdgeId(options.incomingEdgeId || '');
    expandFiberMappingContainer(node.key);
    setFiberMappingSelectedNodeKeys([node.key]);
    setFiberMappingSelectedEdgeId('');
    setFiberMappingNapMenuPonId('');
    resetFiberLayoutModalView();
    setModalType('fiber-layout');
  }

  function closeFiberMappingLayoutModal() {
    if (fiberLayoutReturnPonId) {
      setFiberMappingLayoutContainerKey('');
      setFiberLayoutReturnPonId('');
      setFiberLayoutIncomingEdgeId('');
      setFiberMappingSelectedSplitterKey('');
      fiberMappingSelectedSplitterKeyRef.current = '';
      setFiberSplitterAddDraft(null);
      resetFiberLayoutModalView();
      setModalType('pon-fiber-link');
      return;
    }
    closeModal();
  }

  function openPonFiberLinkNodeLayout(event, node) {
    if (!node?.key || !['nap', 'junction'].includes(node.type)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const incomingEdge = ponFiberLinkCanvas.edges.find((edge) => edge.toKey === node.key) || null;
    openFiberMappingLayoutModal(node, {
      returnPonId: fiberLinkCanvasPonId,
      incomingEdgeId: incomingEdge?.id || ''
    });
  }

  function handleFiberMappingNodeClick(event, node, isFiberContainer) {
    if (fiberMappingNodeSuppressClickRef.current) {
      fiberMappingNodeSuppressClickRef.current = false;
      return;
    }
    if (!isFiberContainer) return;
    if (event.target.closest('button, input, select, textarea, a, .network-fiber-map-nap-menu, .network-fiber-map-internal-canvas')) return;
    event.stopPropagation();
    setFiberMappingSelectedNodeKeys([node.key]);
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingNapMenuPonId('');
    expandFiberMappingContainer(node.key);
  }

  function startFiberMappingInternalSplitterDrag(event, containerKey, assignment, position, metrics) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget?.focus?.();
    fiberMappingInternalSuppressClickRef.current.splitter = false;
    const selectionKey = fiberMapSplitterSelectionKey(containerKey, assignment.assignmentId);
    fiberMappingSelectedSplitterKeyRef.current = selectionKey;
    setFiberMappingSelectedSplitterKey(selectionKey);
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedEdgeId('');
    fiberMappingInternalSplitterDragRef.current = {
      pointerId: event.pointerId,
      containerKey,
      assignmentId: assignment.assignmentId,
      clientX: event.clientX,
      clientY: event.clientY,
      startX: position.x,
      startY: position.y,
      width: metrics.width,
      height: metrics.height,
      scale: fiberInternalDragScale(event),
      position,
      moved: false,
      undoSnapshot: normalizeFiberMapping(fiberMapping)
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFiberMappingInternalSplitterDrag(event) {
    const drag = fiberMappingInternalSplitterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = drag.scale || 1;
    const deltaX = (event.clientX - drag.clientX) / scale;
    const deltaY = (event.clientY - drag.clientY) / scale;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
    const nextPosition = {
      x: clamp(drag.startX + deltaX, 72, drag.width - 72),
      y: clamp(drag.startY + deltaY, 50, drag.height - 50)
    };
    drag.position = nextPosition;
    setFiberMapping((current) => nextFiberMappingWithSplitterPosition(current, drag.containerKey, drag.assignmentId, nextPosition));
  }

  function endFiberMappingInternalSplitterDrag(event) {
    const drag = fiberMappingInternalSplitterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    fiberMappingInternalSplitterDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    fiberMappingInternalSuppressClickRef.current.splitter = drag.moved;
    if (drag.moved) {
      const next = nextFiberMappingWithSplitterPosition(fiberMapping, drag.containerKey, drag.assignmentId, drag.position);
      saveFiberMapping(next, '', { undoSnapshot: drag.undoSnapshot });
    }
  }

  function handleFiberMappingInternalSplitterClick(event, containerKey, assignmentId) {
    event.preventDefault();
    event.stopPropagation();
    if (fiberMappingInternalSuppressClickRef.current.splitter) {
      fiberMappingInternalSuppressClickRef.current.splitter = false;
      return;
    }
    selectFiberMappingSplitter(event, containerKey, assignmentId);
  }

  function startFiberMappingInternalConnectionDrag(event, containerKey, assignmentId, terminal, position, metrics) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    fiberMappingInternalSuppressClickRef.current.connection = false;
    fiberMappingInternalConnectionDragRef.current = {
      pointerId: event.pointerId,
      containerKey,
      assignmentId,
      terminal,
      clientX: event.clientX,
      clientY: event.clientY,
      startX: position.x,
      startY: position.y,
      width: metrics.width,
      height: metrics.height,
      scale: fiberInternalDragScale(event),
      position,
      moved: false,
      undoSnapshot: normalizeFiberMapping(fiberMapping)
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFiberMappingInternalConnectionDrag(event) {
    const drag = fiberMappingInternalConnectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = drag.scale || 1;
    const deltaX = (event.clientX - drag.clientX) / scale;
    const deltaY = (event.clientY - drag.clientY) / scale;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
    const nextPosition = {
      x: clamp(drag.startX + deltaX, 0, drag.width),
      y: clamp(drag.startY + deltaY, 0, drag.height)
    };
    drag.position = nextPosition;
    setFiberMapping((current) => nextFiberMappingWithConnectionPointPosition(
      current,
      drag.containerKey,
      drag.assignmentId,
      drag.terminal,
      nextPosition
    ));
  }

  function endFiberMappingInternalConnectionDrag(event) {
    const drag = fiberMappingInternalConnectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    fiberMappingInternalConnectionDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    fiberMappingInternalSuppressClickRef.current.connection = drag.moved;
    if (drag.moved) {
      if (attachFiberMappingConnectorIfNearInput(drag)) return;
      const next = nextFiberMappingWithConnectionPointPosition(
        fiberMapping,
        drag.containerKey,
        drag.assignmentId,
        drag.terminal,
        drag.position
      );
      saveFiberMapping(next, '', { undoSnapshot: drag.undoSnapshot });
    }
  }

  function fiberContainerEndpointElement(containerKey, endpoint) {
    const endpointKey = `${containerKey}|${endpoint}`;
    return Array.from(document.querySelectorAll('[data-fiber-container-endpoint]'))
      .find((element) => element.dataset.fiberContainerEndpoint === endpointKey) || null;
  }

  function attachFiberMappingConnectorIfNearContainerEndpoint(drag, event = null) {
    if (!drag) return false;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const assignments = containerSplitterAssignments(mapping, drag.containerKey).map((assignment) => ({
      ...assignment,
      splitter: splittersById.get(assignment.splitterId)
    }));
    const metrics = fiberInternalCanvasMetrics(assignments, drag.containerKey);
    const endpoint = drag.terminal === 'input' ? 'input' : 'output';
    const target = fiberContainerEndpointPoint(metrics, endpoint);
    const canvasDistance = Math.hypot(target.x - drag.position.x, target.y - drag.position.y);
    let visualDistance = Number.POSITIVE_INFINITY;
    const endpointElement = fiberContainerEndpointElement(drag.containerKey, endpoint);
    if (endpointElement && event) {
      const rect = endpointElement.getBoundingClientRect();
      visualDistance = Math.hypot((rect.left + rect.width / 2) - event.clientX, (rect.top + rect.height / 2) - event.clientY);
    }
    if (canvasDistance > 56 && visualDistance > 56) return false;
    const snapPoint = visualDistance <= 56 && canvasDistance > 56
      ? {
        x: clamp(drag.position.x, 0, metrics.width),
        y: clamp(drag.position.y, 0, metrics.height)
      }
      : target;
    const next = nextFiberMappingWithConnectionPointPosition(
      mapping,
      drag.containerKey,
      drag.assignmentId,
      drag.terminal,
      snapPoint
    );
    saveFiberMapping(next, endpoint === 'input' ? 'Connected to IN.' : 'Connected to OUT.', { undoSnapshot: drag.undoSnapshot });
    return true;
  }

  function attachFiberMappingConnectorIfNearInput(drag) {
    if (!drag || drag.terminal === 'input') return false;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const assignments = containerSplitterAssignments(mapping, drag.containerKey).map((assignment) => ({
      ...assignment,
      splitter: splittersById.get(assignment.splitterId)
    }));
    if (!assignments.length) return false;
    const sourceAssignment = assignments.find((assignment) => assignment.assignmentId === drag.assignmentId);
    if (!sourceAssignment) return false;
    const metrics = fiberInternalCanvasMetrics(assignments, drag.containerKey);
    let nearest = null;
    assignments.forEach((assignment, index) => {
      if (assignment.assignmentId === drag.assignmentId) return;
      let cursor = sourceAssignment;
      while (cursor?.parentAssignmentId) {
        if (cursor.parentAssignmentId === assignment.assignmentId) return;
        cursor = assignments.find((candidate) => candidate.assignmentId === cursor.parentAssignmentId);
      }
      const inputPoint = fiberInternalConnectionPointPosition(
        drag.containerKey,
        assignment.assignmentId,
        'input',
        fiberInternalInputFallback(fiberInternalSplitterPosition(assignment, index), index, metrics, assignment)
      );
      const distance = Math.hypot(inputPoint.x - drag.position.x, inputPoint.y - drag.position.y);
      if (distance <= 38 && (!nearest || distance < nearest.distance)) {
        nearest = { assignment, distance };
      }
    });
    if (!nearest) return false;
    const nextAssignments = assignments.map((assignment) => {
      if (assignment.assignmentId === nearest.assignment.assignmentId) {
        return {
          ...assignment,
          parentAssignmentId: drag.assignmentId,
          parentTerminal: drag.terminal
        };
      }
      if (assignment.parentAssignmentId === drag.assignmentId && assignment.parentTerminal === drag.terminal) {
        return {
          ...assignment,
          parentAssignmentId: '',
          parentTerminal: ''
        };
      }
      return assignment;
    }).map(({ splitter, ...assignment }) => assignment);
    const connectionPoints = { ...mapping.connectionPoints };
    delete connectionPoints[fiberMapConnectionPointKey(drag.containerKey, drag.assignmentId, drag.terminal)];
    const next = {
      ...mapping,
      connectionPoints,
      containerSplitterAssignments: {
        ...mapping.containerSplitterAssignments,
        [drag.containerKey]: nextAssignments
      }
    };
    setFiberMappingSelectedSplitterKey(fiberMapSplitterSelectionKey(drag.containerKey, nearest.assignment.assignmentId));
    fiberMappingSelectedSplitterKeyRef.current = fiberMapSplitterSelectionKey(drag.containerKey, nearest.assignment.assignmentId);
    saveFiberMapping(next, 'Splitters connected.', { undoSnapshot: drag.undoSnapshot });
    return true;
  }

  function handleFiberMappingInternalConnectionClick(event, containerKey, assignmentId, terminal) {
    event.preventDefault();
    event.stopPropagation();
    if (fiberMappingInternalSuppressClickRef.current.connection) {
      fiberMappingInternalSuppressClickRef.current.connection = false;
      return;
    }
    cycleFiberConnectionPoint(containerKey, assignmentId, terminal);
  }

  function addNapToFiberMapping(ponId, napId, sourceNode = null) {
    const nap = napsById.get(napId);
    if (!nap) return;
    const ponKey = fiberMapNodeKey('pon', ponId);
    const napKey = fiberMapNodeKey('nap', napId);
    const existingNode = fiberMappingCanvas.nodes.find((node) => node.key === napKey);
    setFiberMappingNapMenuPonId('');
    if (existingNode) {
      setFiberMappingSelectedNodeKeys([napKey]);
      setFiberMappingSelectedEdgeId('');
      setFiberMappingSelectedSplitterKey('');
      fiberMappingSelectedSplitterKeyRef.current = '';
      setMessage(`${nap.name} is already on Network Topology.`);
      return;
    }
    const ponNode = fiberMappingCanvas.nodes.find((node) => node.key === ponKey);
    const sourceKey = sourceNode?.key || ponKey;
    const sourceCanvasNode = fiberMappingCanvas.nodes.find((node) => node.key === sourceKey) || ponNode;
    const sourceSiblingCount = fiberMappingCanvas.nodes.filter((node) => (
      node.type === 'nap'
      && node.key !== napKey
      && (node.sourceKey || fiberMapNodeKey('pon', node.ponId)) === sourceKey
    )).length;
    const initialPatch = {
      x: (sourceCanvasNode?.x || ponNode?.x || 420) + 320,
      y: (sourceCanvasNode?.y || ponNode?.y || 140) + sourceSiblingCount * 166,
      sourceKey,
      locked: false,
      visible: true
    };
    const candidateNodes = [
      ...fiberMappingCanvas.nodes.filter((node) => node.key !== napKey),
      {
        key: napKey,
        ...initialPatch,
        width: FIBER_MAPPING_NODE_SIZE.nap.width,
        height: FIBER_MAPPING_NODE_SIZE.nap.height,
        type: 'nap',
        oltId: nap.oltId || sourceCanvasNode?.oltId || '',
        ponId
      }
    ];
    const overlapPatches = fiberMappingResolveNodeOverlaps(candidateNodes, fiberMappingExpandedContainerKeys, {
      protectedKeys: [napKey]
    });
    const patches = {
      [napKey]: {
        ...initialPatch,
        ...(overlapPatches[napKey] || {})
      },
      ...Object.fromEntries(Object.entries(overlapPatches).filter(([nodeKey]) => nodeKey !== napKey))
    };
    const next = nextFiberMappingWithNodes(fiberMapping, patches);
    saveFiberMapping(next, `${nap.name} added to Network Topology.`);
  }

  function makeFiberMappingJunctionId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `junction-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function addJunctionBoxToFiberMapping(sourceNode) {
    if (!sourceNode?.key) return;
    const mapping = normalizeFiberMapping(fiberMapping);
    const junctionId = makeFiberMappingJunctionId();
    const junctionKey = fiberMapNodeKey('junction', junctionId);
    const siblingCount = Object.values(mapping.junctionBoxes || {}).filter((junction) => junction.sourceKey === sourceNode.key).length;
    const label = `Junction Box ${Object.keys(mapping.junctionBoxes || {}).length + 1}`;
    const sourcePonId = sourceNode.type === 'pon' ? sourceNode.source?.id : sourceNode.ponId || '';
    const initialPatch = {
      x: Math.round(sourceNode.x + 310),
      y: Math.round(sourceNode.y + siblingCount * 166),
      locked: false,
      visible: true
    };
    const candidateNodes = [
      ...fiberMappingCanvas.nodes.filter((node) => node.key !== junctionKey),
      {
        key: junctionKey,
        ...initialPatch,
        width: FIBER_MAPPING_NODE_SIZE.junction.width,
        height: FIBER_MAPPING_NODE_SIZE.junction.height,
        type: 'junction',
        sourceKey: sourceNode.key,
        oltId: sourceNode.oltId || '',
        ponId: sourcePonId
      }
    ];
    const overlapPatches = fiberMappingResolveNodeOverlaps(candidateNodes, fiberMappingExpandedContainerKeys, {
      protectedKeys: [junctionKey]
    });
    const nodePatches = {
      [junctionKey]: {
        ...initialPatch,
        ...(overlapPatches[junctionKey] || {})
      },
      ...Object.fromEntries(Object.entries(overlapPatches).filter(([nodeKey]) => nodeKey !== junctionKey))
    };
    const next = {
      ...mapping,
      junctionBoxes: {
        ...mapping.junctionBoxes,
        [junctionId]: {
          id: junctionId,
          name: label,
          sourceKey: sourceNode.key,
          sourceLabel: sourceNode.label,
          oltId: sourceNode.oltId || '',
          ponId: sourcePonId,
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      },
      nodes: {
        ...mapping.nodes,
        ...Object.fromEntries(
          Object.entries(nodePatches).map(([nodeKey, patch]) => [
            nodeKey,
            {
              ...(mapping.nodes[nodeKey] || {}),
              ...patch
            }
          ])
        )
      }
    };
    setFiberMappingNapMenuPonId('');
    saveFiberMapping(next, `${label} added to Network Topology.`);
  }

  function connectionPointValue(point) {
    return String(point?.connectionType || point?.type || 'FUSION').toUpperCase();
  }

  function connectionPointLabel(point) {
    const value = connectionPointValue(point);
    return FIBER_CONNECTION_TYPES.find((item) => item.value === value)?.label || 'Fusion';
  }

  function cycleFiberConnectionPoint(containerKey, assignmentId, terminal) {
    const mapping = normalizeFiberMapping(fiberMapping);
    const pointKey = fiberMapConnectionPointKey(containerKey, assignmentId, terminal);
    const currentValue = connectionPointValue(mapping.connectionPoints?.[pointKey]);
    const currentIndex = FIBER_CONNECTION_TYPES.findIndex((item) => item.value === currentValue);
    const nextType = FIBER_CONNECTION_TYPES[(currentIndex + 1) % FIBER_CONNECTION_TYPES.length];
    const nextMapping = syncIncomingFiberEdgeConnector({
      ...mapping,
      connectionPoints: {
        ...mapping.connectionPoints,
        [pointKey]: {
          ...(mapping.connectionPoints?.[pointKey] || {}),
          connectionType: nextType.value,
          label: nextType.label,
          updatedAt: new Date().toISOString()
        }
      }
    }, containerKey, assignmentId, terminal, nextType.value);
    saveFiberMapping(nextMapping, `${nextType.label} connection labeled.`);
  }

  function fbtRatioOptions(splitter) {
    const ratioRows = normalizeFbtRatioRows(splitter?.ratioRows, splitter?.splitRatio || '5:95', meta.fbtSplitRatios || defaultMeta.fbtSplitRatios, splitter);
    return ratioRows.length
      ? ratioRows.map((row) => row.ratio)
      : [normalizeFbtRatioValue(splitter?.splitRatio || '5:95')];
  }

  function portLossSplitterRatioOptions(splitter) {
    const splitterType = normalizeSplitterType(splitter?.splitterType);
    return normalizeSplitterRatioProfiles(
      splitterType,
      splitter?.ratioProfiles,
      splitter?.splitRatio,
      splitter?.portLosses,
      splitter?.insertionLossDb,
      ratioOptionsForSplitterType(splitterType, meta)
    ).map((profile) => profile.splitRatio);
  }

  function splitterAssignmentOptions(splitters = fbts) {
    return splitters.flatMap((splitter) => {
      const splitterType = normalizeSplitterType(splitter.splitterType);
      if (splitterType === 'FBT') {
        return fbtRatioOptions(splitter).map((ratio) => ({
          key: `${splitter.id}::${ratio}`,
          splitterId: splitter.id,
          ratio,
          label: `${splitterType} ${ratio} / ${splitter.manufacturer || splitter.brand || 'Splitter'} ${splitter.model || splitter.name || ''}`.trim()
        }));
      }
      if (isPortLossSplitterType(splitterType)) {
        return portLossSplitterRatioOptions(splitter).map((ratio) => ({
          key: `${splitter.id}::${ratio}`,
          splitterId: splitter.id,
          ratio,
          label: `${splitterType} ${formatSplitterRatio(ratio)} / ${splitter.manufacturer || splitter.brand || 'Splitter'} ${splitter.model || splitter.name || ''}`.trim()
        }));
      }
      const ratio = splitter.splitRatio || (splitter.outputPorts ? `1:${splitter.outputPorts}` : '');
      return [{
        key: `${splitter.id}::${ratio}`,
        splitterId: splitter.id,
        ratio,
        label: `${splitterType} ${ratio || ''} / ${splitter.manufacturer || splitter.brand || 'Splitter'} ${splitter.model || splitter.name || ''}`.trim()
      }];
    });
  }

  function parseSplitterAssignmentValue(value) {
    const [splitterId = '', ratio = ''] = String(value || '').split('::');
    return { splitterId, ratio };
  }

  function fiberSplitterTypeOptions() {
    const availableTypes = [...new Set(fbts.map((splitter) => normalizeSplitterType(splitter.splitterType)).filter(Boolean))];
    const preferredTypes = ['FBT', 'PLC', 'LCP'].filter((type) => availableTypes.includes(type));
    const extraTypes = availableTypes.filter((type) => !preferredTypes.includes(type)).sort();
    return [...preferredTypes, ...extraTypes];
  }

  function splittersForPickerType(splitterType) {
    return fbts.filter((splitter) => normalizeSplitterType(splitter.splitterType) === splitterType);
  }

  function fiberSplitterRatioChoices(splitter) {
    if (!splitter) return [];
    const splitterType = normalizeSplitterType(splitter.splitterType);
    if (splitterType === 'FBT') {
      return fbtRatioOptions(splitter).map((ratio) => ({ value: ratio, label: ratio }));
    }
    if (isPortLossSplitterType(splitterType)) {
      return portLossSplitterRatioOptions(splitter).map((ratio) => ({ value: ratio, label: formatSplitterRatio(ratio) }));
    }
    const ratio = splitter.splitRatio || (splitter.outputPorts ? `1:${splitter.outputPorts}` : '');
    return [{ value: ratio, label: ratio || 'Default output' }];
  }

  function fiberSplitterSummaryToken(assignment) {
    const splitter = assignment?.splitter || splittersById.get(assignment?.splitterId);
    if (!splitter) return '';
    const splitterType = normalizeSplitterType(splitter.splitterType);
    if (splitterType === 'FBT') {
      const ratio = normalizeFbtRatioValue(assignment.ratio || splitter.splitRatio || fbtRatioOptions(splitter)[0] || '5:95');
      return `FBT:${formatFbtRatio(ratio)}`;
    }
    if (isPortLossSplitterType(splitterType)) {
      const ratio = assignment.ratio || splitter.splitRatio || portLossSplitterRatioOptions(splitter)[0] || '';
      return ratio ? `${formatSplitterRatio(ratio)}${splitterType}` : splitterType;
    }
    const ratio = assignment.ratio || splitter.splitRatio || (splitter.outputPorts ? `1:${splitter.outputPorts}` : '');
    return ratio ? `${formatSplitterRatio(ratio)}${splitterType}` : splitterType;
  }

  function fiberSplitterSummaryText(assignments = []) {
    return assignments.map(fiberSplitterSummaryToken).filter(Boolean).join('-');
  }

  function makeFiberSplitterAddDraft(containerKey, afterAssignmentId = '', parentTerminal = '', anchorPoint = null) {
    const [firstType = ''] = fiberSplitterTypeOptions();
    const [firstSplitter] = firstType ? splittersForPickerType(firstType) : [];
    const [firstRatio] = fiberSplitterRatioChoices(firstSplitter);
    const anchor = anchorPoint || { x: FIBER_INTERNAL_CANVAS.inputX + 48, y: FIBER_INTERNAL_CANVAS.height / 2 };
    return {
      containerKey,
      afterAssignmentId,
      parentTerminal,
      anchorX: Math.round(anchor.x),
      anchorY: Math.round(anchor.y),
      splitterType: firstType,
      splitterId: firstSplitter?.id || '',
      ratio: firstRatio?.value || ''
    };
  }

  function openFiberSplitterPicker(containerKey, afterAssignmentId = '', parentTerminal = '', anchorPoint = null) {
    if (!fbts.length) {
      setMessage('Add a splitter catalog record first.');
      return;
    }
    const draft = makeFiberSplitterAddDraft(containerKey, afterAssignmentId, parentTerminal, anchorPoint);
    if (!draft.splitterType || !draft.splitterId) {
      setMessage('Add a splitter catalog record first.');
      return;
    }
    setFiberSplitterAddDraft(draft);
  }

  function updateFiberSplitterPickerType(splitterType) {
    setFiberSplitterAddDraft((current) => {
      if (!current) return current;
      const [firstSplitter] = splittersForPickerType(splitterType);
      const [firstRatio] = fiberSplitterRatioChoices(firstSplitter);
      return {
        ...current,
        splitterType,
        splitterId: firstSplitter?.id || '',
        ratio: firstRatio?.value || ''
      };
    });
  }

  function updateFiberSplitterPickerSplitter(splitterId) {
    setFiberSplitterAddDraft((current) => {
      if (!current) return current;
      const splitter = fbts.find((item) => item.id === splitterId);
      const [firstRatio] = fiberSplitterRatioChoices(splitter);
      return {
        ...current,
        splitterId,
        ratio: firstRatio?.value || ''
      };
    });
  }

  function closeFiberSplitterPicker() {
    setFiberSplitterAddDraft(null);
  }

  function submitFiberSplitterPicker(event) {
    event?.preventDefault?.();
    const draft = fiberSplitterAddDraft;
    if (!draft?.containerKey || !draft.splitterId) return;
    const added = assignSplitterToFiberContainer(
      draft.containerKey,
      `${draft.splitterId}::${draft.ratio || ''}`,
      {
        afterAssignmentId: draft.afterAssignmentId,
        parentTerminal: draft.parentTerminal
      }
    );
    if (!added) return;
    setFiberSplitterAddDraft(null);
  }

  function containerSplitterAssignments(mapping, containerKey) {
    const assignments = mapping.containerSplitterAssignments?.[containerKey];
    if (Array.isArray(assignments) && assignments.length) return assignments;
    const splitterIds = containerKey.startsWith('nap:')
      ? mapping.containerSplitters?.[containerKey] || mapping.napSplitters?.[containerKey.split(':', 2)[1]] || []
      : mapping.containerSplitters?.[containerKey] || [];
    return splitterIds.map((splitterId, index) => ({
      assignmentId: `${splitterId}-${index + 1}`,
      splitterId,
      ratio: ''
    }));
  }

  function assignSplitterToFiberContainer(containerKey, value, options = {}) {
    if (!value || !containerKey) return false;
    const { splitterId, ratio } = parseSplitterAssignmentValue(value);
    if (!splitterId) return false;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const currentAssignments = containerSplitterAssignments(mapping, containerKey);
    const insertAfterIndex = options.afterAssignmentId
      ? currentAssignments.findIndex((assignment) => assignment.assignmentId === options.afterAssignmentId)
      : -1;
    const insertIndex = currentAssignments.length;
    const parentAssignment = insertAfterIndex >= 0 ? currentAssignments[insertAfterIndex] : null;
    const parentTerminal = parentAssignment
      ? resolveFiberMappingChildTerminal(mapping, currentAssignments, parentAssignment, insertAfterIndex, options.parentTerminal)
      : '';
    if (parentAssignment && !parentTerminal) return false;
    const anchorPosition = parentAssignment ? fiberInternalSplitterPosition(parentAssignment, insertAfterIndex) : null;
    const fallbackPosition = fiberInternalDefaultSplitterPosition(insertIndex);
    const terminalPosition = anchorPosition && parentTerminal
      ? fiberInternalChildPositionForTerminal(anchorPosition, parentTerminal)
      : null;
    const position = options.position || terminalPosition || fallbackPosition;
    const nextAssignment = {
      assignmentId: makeFiberMappingAssignmentId(splitterId),
      splitterId,
      ratio,
      positionX: Math.round(position.x),
      positionY: Math.round(position.y)
    };
    if (parentAssignment && parentTerminal) {
      nextAssignment.parentAssignmentId = parentAssignment.assignmentId;
      nextAssignment.parentTerminal = parentTerminal;
    }
    const nextAssignments = [...currentAssignments];
    nextAssignments.splice(insertIndex, 0, nextAssignment);
    const nextIds = [...new Set(nextAssignments.map((assignment) => assignment.splitterId))];
    const next = {
      ...mapping,
      containerSplitters: {
        ...mapping.containerSplitters,
        [containerKey]: nextIds
      },
      containerSplitterAssignments: {
        ...mapping.containerSplitterAssignments,
        [containerKey]: nextAssignments
      }
    };
    if (containerKey.startsWith('nap:')) {
      next.napSplitters = {
        ...mapping.napSplitters,
        [containerKey.split(':', 2)[1]]: nextIds
      };
    }
    const nextSelectionKey = fiberMapSplitterSelectionKey(containerKey, nextAssignment.assignmentId);
    setFiberMappingSelectedSplitterKey(nextSelectionKey);
    fiberMappingSelectedSplitterKeyRef.current = nextSelectionKey;
    setFiberMappingSpawnedSplitterKey(nextSelectionKey);
    window.setTimeout(() => {
      setFiberMappingSpawnedSplitterKey((current) => (current === nextSelectionKey ? '' : current));
    }, 700);
    saveFiberMapping(next, 'Splitter added.');
    return true;
  }

  function fiberAssignmentOutputTerminals(assignment, splitterMap = splittersById) {
    const splitter = assignment?.splitter || splitterMap.get(assignment?.splitterId) || {};
    return normalizeSplitterType(splitter.splitterType) === 'FBT' ? ['splitA', 'splitB'] : ['output'];
  }

  function fiberLegacyChildTerminalForAssignment(assignment) {
    return fiberAssignmentOutputTerminals(assignment).includes('splitA') ? 'splitA' : 'output';
  }

  function fiberInternalChildPositionForTerminal(anchorPosition, terminal) {
    const verticalOffset = terminal === 'splitA' ? FIBER_INTERNAL_CANVAS.outputGap : terminal === 'splitB' ? -FIBER_INTERNAL_CANVAS.outputGap : 0;
    return {
      x: anchorPosition.x + FIBER_INTERNAL_CANVAS.branchLength + 54,
      y: anchorPosition.y + verticalOffset
    };
  }

  function resolveFiberMappingChildTerminal(mapping, assignments, parentAssignment, parentIndex, requestedTerminal = '') {
    const terminals = fiberAssignmentOutputTerminals(parentAssignment);
    if (!terminals.length) return '';
    const occupied = new Set();
    assignments.forEach((assignment, index) => {
      if (assignment.assignmentId === parentAssignment.assignmentId) return;
      if (assignment.parentAssignmentId === parentAssignment.assignmentId && terminals.includes(assignment.parentTerminal)) {
        occupied.add(assignment.parentTerminal);
        return;
      }
      if (index === parentIndex + 1 && !assignment.parentAssignmentId) {
        occupied.add(fiberLegacyChildTerminalForAssignment(parentAssignment));
      }
    });
    const requested = terminals.includes(requestedTerminal) ? requestedTerminal : terminals[terminals.length - 1];
    if (!occupied.has(requested)) return requested;
    const fallback = terminals.find((terminal) => !occupied.has(terminal));
    if (fallback) return fallback;
    const label = terminals.map((terminal) => terminal.replace('split', 'split ')).join(' and ');
    setMessage(`Both ${label} outputs already have splitters.`);
    return '';
  }

  function fiberMappingOutTerminalForAssignment(assignment, splitterMap = splittersById) {
    const terminals = fiberAssignmentOutputTerminals(assignment, splitterMap);
    if (terminals.includes('splitB')) return 'splitB';
    return terminals[terminals.length - 1] || 'output';
  }

  function fiberMappingEndpointRole(point) {
    return point?.endpointRole === 'input' || point?.endpointRole === 'output' ? point.endpointRole : '';
  }

  function fiberMappingConnectionPointForTerminal(containerKey, assignmentId, terminal) {
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    return mapping.connectionPoints?.[fiberMapConnectionPointKey(containerKey, assignmentId, terminal)] || null;
  }

  function toggleFiberMappingSplitterEndpointRole(containerKey, assignmentId, endpoint, terminal, point, naturalPoint, metrics) {
    if (!containerKey || !assignmentId || !terminal) return;
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const currentAssignments = containerSplitterAssignments(mapping, containerKey);
    const assignmentIndex = currentAssignments.findIndex((assignment) => assignment.assignmentId === assignmentId);
    if (assignmentIndex < 0) return;
    const role = endpoint === 'input' ? 'input' : 'output';
    const pointKey = fiberMapConnectionPointKey(containerKey, assignmentId, terminal);
    const currentPoint = mapping.connectionPoints?.[pointKey] || {};
    const isRemoving = fiberMappingEndpointRole(currentPoint) === role;
    const connectionPoints = { ...mapping.connectionPoints };
    if (isRemoving) {
      const { endpointRole, ...remainingPoint } = currentPoint;
      if (Object.keys(remainingPoint).length) connectionPoints[pointKey] = remainingPoint;
      else delete connectionPoints[pointKey];
      saveFiberMapping({ ...mapping, connectionPoints }, endpoint === 'input' ? 'IN removed.' : 'OUT removed.');
      return;
    }
    Object.entries(connectionPoints).forEach(([key, value]) => {
      if (!key.startsWith(`${containerKey}|`) || fiberMappingEndpointRole(value) !== role) return;
      const { endpointRole, ...remainingPoint } = value;
      if (Object.keys(remainingPoint).length) connectionPoints[key] = remainingPoint;
      else delete connectionPoints[key];
    });
    const currentPosition = point || naturalPoint || { x: FIBER_INTERNAL_CANVAS.inputX, y: FIBER_INTERNAL_CANVAS.height / 2 };
    const fallbackPosition = naturalPoint || currentPosition;
    const isOldFixedTarget = metrics && (
      (endpoint === 'input' && Number(currentPosition.x) <= 2)
      || (endpoint === 'output' && Number(currentPosition.x) >= Number(metrics.width) - 2)
    );
    const targetPoint = isOldFixedTarget ? fallbackPosition : currentPosition;
    const nextAssignments = currentAssignments.map((currentAssignment) => {
      if (endpoint === 'input' && currentAssignment.assignmentId === assignmentId) {
        return {
          ...currentAssignment,
          parentAssignmentId: '',
          parentTerminal: ''
        };
      }
      if (endpoint === 'output' && currentAssignment.parentAssignmentId === assignmentId && currentAssignment.parentTerminal === terminal) {
        return {
          ...currentAssignment,
          parentAssignmentId: '',
          parentTerminal: ''
        };
      }
      return currentAssignment;
    });
    const next = {
      ...mapping,
      connectionPoints: {
        ...connectionPoints,
        [pointKey]: {
          ...(connectionPoints[pointKey] || {}),
          positionX: Math.round(targetPoint.x),
          positionY: Math.round(targetPoint.y),
          endpointRole: role
        }
      },
      containerSplitterAssignments: {
        ...mapping.containerSplitterAssignments,
        [containerKey]: nextAssignments
      }
    };
    setFiberMappingSelectedSplitterKey(fiberMapSplitterSelectionKey(containerKey, assignmentId));
    fiberMappingSelectedSplitterKeyRef.current = fiberMapSplitterSelectionKey(containerKey, assignmentId);
    saveFiberMapping(next, endpoint === 'input' ? 'Splitter set as IN.' : 'Splitter set as OUT.');
  }

  function addDefaultSplitterToFiberContainer(containerKey, afterAssignmentId = '', parentTerminal = '', anchorPoint = null) {
    openFiberSplitterPicker(containerKey, afterAssignmentId, parentTerminal, anchorPoint);
  }

  function removeSplitterFromFiberContainer(containerKey, assignmentId) {
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const currentAssignments = containerSplitterAssignments(mapping, containerKey);
    const nextAssignments = currentAssignments
      .filter((assignment) => assignment.assignmentId !== assignmentId)
      .map((assignment) => (
        assignment.parentAssignmentId === assignmentId
          ? {
            ...assignment,
            parentAssignmentId: '',
            parentTerminal: ''
          }
          : assignment
      ));
    const nextIds = [...new Set(nextAssignments.map((assignment) => assignment.splitterId))];
    const containerSplitters = { ...mapping.containerSplitters };
    const nextContainerSplitterAssignments = { ...mapping.containerSplitterAssignments };
    const napSplitters = { ...mapping.napSplitters };
    const connectionPoints = { ...mapping.connectionPoints };
    Object.keys(connectionPoints).forEach((pointKey) => {
      if (pointKey.startsWith(`${containerKey}|${assignmentId}|`)) delete connectionPoints[pointKey];
    });
    if (nextIds.length) containerSplitters[containerKey] = nextIds;
    else delete containerSplitters[containerKey];
    if (nextAssignments.length) nextContainerSplitterAssignments[containerKey] = nextAssignments;
    else delete nextContainerSplitterAssignments[containerKey];
    if (containerKey.startsWith('nap:')) {
      const napId = containerKey.split(':', 2)[1];
      if (nextIds.length) napSplitters[napId] = nextIds;
      else delete napSplitters[napId];
    }
    if (parseFiberMapSplitterSelectionKey(fiberMappingSelectedSplitterKeyRef.current || fiberMappingSelectedSplitterKey).assignmentId === assignmentId) {
      setFiberMappingSelectedSplitterKey('');
      fiberMappingSelectedSplitterKeyRef.current = '';
    }
    saveFiberMapping({ ...mapping, containerSplitters, containerSplitterAssignments: nextContainerSplitterAssignments, napSplitters, connectionPoints }, 'Splitter removed.');
  }

  function selectFiberMappingSplitter(event, containerKey, assignmentId) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.currentTarget?.focus?.();
    const selectionKey = fiberMapSplitterSelectionKey(containerKey, assignmentId);
    fiberMappingSelectedSplitterKeyRef.current = selectionKey;
    setFiberMappingSelectedSplitterKey(selectionKey);
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectionBox(null);
  }

  function collectFiberMappingDeleteKeys(nodeKeys, sourceMapping = null) {
    const mapping = normalizeFiberMapping(sourceMapping || fiberMappingRef.current || fiberMapping);
    const requestedKeys = new Set((nodeKeys || []).filter((key) => key.startsWith('nap:') || key.startsWith('junction:')));
    const removeKeys = new Set(requestedKeys);
    let changed = true;
    while (changed) {
      changed = false;
      Object.entries(mapping.nodes || {}).forEach(([key, node]) => {
        if (!removeKeys.has(key) && removeKeys.has(node?.sourceKey) && (key.startsWith('nap:') || key.startsWith('junction:'))) {
          removeKeys.add(key);
          changed = true;
        }
      });
      Object.values(mapping.junctionBoxes || {}).forEach((junction) => {
        const key = fiberMapNodeKey('junction', junction.id);
        if (!removeKeys.has(key) && removeKeys.has(junction.sourceKey)) {
          removeKeys.add(key);
          changed = true;
        }
      });
    }
    return removeKeys;
  }

  function fiberDeleteObjectInfo(key, mapping) {
    const canvasNode = fiberMappingCanvas.nodes.find((node) => node.key === key);
    const [type, id] = key.split(':', 2);
    if (type === 'nap') {
      const nap = naps.find((row) => row.id === id) || canvasNode?.source || {};
      const pon = pons.find((row) => row.id === nap.ponPortId);
      const olt = olts.find((row) => row.id === nap.oltId || row.id === pon?.oltId);
      return {
        key,
        id,
        type: 'NAP',
        label: canvasNode?.label || nap.name || 'NAP',
        detail: [olt?.name, pon ? canonicalPonLabel(pon) : '', nap.barangay || nap.status].filter(Boolean).join(' / ') || canvasNode?.detail || 'Mapped NAP box'
      };
    }
    const junction = mapping.junctionBoxes?.[id] || canvasNode?.source || {};
    return {
      key,
      id,
      type: 'Junction Box',
      label: canvasNode?.label || junction.name || 'Junction Box',
      detail: [junction.ponLabel, junction.status].filter(Boolean).join(' / ') || canvasNode?.detail || 'Mapped junction branch'
    };
  }

  function buildFiberDeleteTarget(nodeKeys) {
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const keys = [...collectFiberMappingDeleteKeys(nodeKeys, mapping)];
    if (!keys.length) return null;
    const affectedObjects = keys.map((key) => fiberDeleteObjectInfo(key, mapping));
    const primary = fiberDeleteObjectInfo((nodeKeys || []).find((key) => keys.includes(key)) || keys[0], mapping);
    const edgeIds = Object.keys(mapping.edges || {}).filter((edgeId) => keys.some((key) => edgeId.includes(`${key}->`) || edgeId.includes(`->${key}`)));
    const splitterCount = keys.reduce((total, key) => {
      const [, id] = key.split(':', 2);
      return total
        + (mapping.containerSplitterAssignments?.[key] || []).length
        + (key.startsWith('nap:') ? (mapping.napSplitters?.[id] || []).length : 0);
    }, 0);
    return {
      keys,
      primary,
      affectedObjects,
      edgeCount: edgeIds.length,
      splitterCount,
      downstreamCount: Math.max(0, affectedObjects.length - 1)
    };
  }

  function openFiberMappingDeleteModalForKeys(nodeKeys) {
    const target = buildFiberDeleteTarget(nodeKeys);
    if (!target) {
      setMessage('Only mapped NAP and Junction Box objects can be deleted.');
      return;
    }
    setFiberDeleteTarget(target);
    setModalType('fiber-delete-object');
  }

  function confirmFiberMappingDelete(event) {
    event?.preventDefault?.();
    if (!fiberDeleteTarget?.keys?.length) return;
    const objectCount = fiberDeleteTarget.keys.length;
    deleteFiberMappingNodeKeys(
      fiberDeleteTarget.keys,
      `${objectCount} Network Topology object${objectCount === 1 ? '' : 's'} removed.`
    );
    closeModal();
  }

  function deleteFiberMappingNodeKeys(nodeKeys, successMessage = 'Object removed from Network Topology.') {
    const requestedKeys = new Set((nodeKeys || []).filter((key) => key.startsWith('nap:') || key.startsWith('junction:')));
    if (!requestedKeys.size) {
      setMessage('Only mapped NAP and Junction Box objects can be deleted.');
      return;
    }
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const removeKeys = collectFiberMappingDeleteKeys([...requestedKeys], mapping);
    const nodes = { ...mapping.nodes };
    const edges = { ...mapping.edges };
    const napSplitters = { ...mapping.napSplitters };
    const junctionBoxes = { ...mapping.junctionBoxes };
    const containerSplitters = { ...mapping.containerSplitters };
    const containerSplitterAssignments = { ...mapping.containerSplitterAssignments };
    const connectionPoints = { ...mapping.connectionPoints };
    removeKeys.forEach((key) => {
      delete nodes[key];
      delete containerSplitters[key];
      delete containerSplitterAssignments[key];
      if (key.startsWith('nap:')) delete napSplitters[key.split(':', 2)[1]];
      if (key.startsWith('junction:')) delete junctionBoxes[key.split(':', 2)[1]];
      Object.keys(connectionPoints).forEach((pointKey) => {
        if (pointKey.startsWith(`${key}|`)) delete connectionPoints[pointKey];
      });
      Object.keys(edges).forEach((edgeId) => {
        if (edgeId.includes(`->${key}`) || edgeId.includes(`${key}->`)) delete edges[edgeId];
      });
    });
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingNapMenuPonId('');
    setFiberMappingExpandedContainerKeys((current) => current.filter((key) => !removeKeys.has(key)));
    saveFiberMapping({
      ...mapping,
      nodes,
      edges,
      napSplitters,
      junctionBoxes,
      containerSplitters,
      containerSplitterAssignments,
      connectionPoints
    }, successMessage);
  }

  function removeNapFromFiberMapping(napId) {
    deleteFiberMappingNodeKeys([fiberMapNodeKey('nap', napId)], 'NAP removed from Network Topology.');
  }

  function removeJunctionFromFiberMapping(junctionId) {
    deleteFiberMappingNodeKeys([fiberMapNodeKey('junction', junctionId)], 'Junction box removed from Network Topology.');
  }

  function deleteSelectedFiberMappingObjects() {
    if (!fiberMappingSelectedNodeKeys.length) return;
    const deletableKeys = fiberMappingSelectedNodeKeys.filter((key) => key.startsWith('nap:') || key.startsWith('junction:'));
    if (!deletableKeys.length) {
      setMessage('Only mapped NAP and Junction Box objects can be deleted.');
      return;
    }
    openFiberMappingDeleteModalForKeys(deletableKeys);
  }

  function deleteSelectedFiberMappingSplitter(selectionKey = fiberMappingSelectedSplitterKeyRef.current || fiberMappingSelectedSplitterKey) {
    const { containerKey, assignmentId } = parseFiberMapSplitterSelectionKey(selectionKey);
    if (!containerKey || !assignmentId) {
      setFiberMappingSelectedSplitterKey('');
      fiberMappingSelectedSplitterKeyRef.current = '';
      return;
    }
    const mapping = normalizeFiberMapping(fiberMappingRef.current || fiberMapping);
    const exists = containerSplitterAssignments(mapping, containerKey).some((assignment) => assignment.assignmentId === assignmentId);
    if (!exists) {
      setFiberMappingSelectedSplitterKey('');
      fiberMappingSelectedSplitterKeyRef.current = '';
      return;
    }
    removeSplitterFromFiberContainer(containerKey, assignmentId);
  }

  function resetFiberMapping() {
    if (!window.confirm('Reset Network Topology? This removes mapped NAPs, splitters, saved link settings, and custom node positions. OLT and PON nodes will remain.')) return;
    setFiberMappingNapMenuPonId('');
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingExpandedContainerKeys([]);
    resetFiberMappingViewportToOrigin();
    saveFiberMapping(buildOrganizedFiberMapping(fiberMapping, { resetAddedMapping: true }), 'Network Topology reset to OLT and PON only.');
  }

  function autoOrganizeFiberMapping() {
    setFiberMappingNapMenuPonId('');
    setFiberMappingSelectedEdgeId('');
    setFiberMappingSelectedNodeKeys([]);
    setFiberMappingSelectedSplitterKey('');
    fiberMappingSelectedSplitterKeyRef.current = '';
    setFiberMappingExpandedContainerKeys([]);
    resetFiberMappingView();
    setMessage('Tree layout refreshed.');
  }

  function expandFiberMappingContainer(containerKey) {
    const wasExpanded = fiberMappingExpandedContainerKeys.includes(containerKey);
    setFiberMappingExpandedContainerKeys((current) => (current.includes(containerKey) ? current : [...current, containerKey]));
    if (!wasExpanded) setMessage('');
  }

  function collapseFiberMappingContainer(containerKey) {
    const wasExpanded = fiberMappingExpandedContainerKeys.includes(containerKey);
    setFiberMappingExpandedContainerKeys((current) => current.filter((key) => key !== containerKey));
    if (wasExpanded) setMessage('');
  }

  function openOltLocationCapture() {
    setOltLocationPickerView((current) => oltPickerViewFromCoordinates(oltLocationForm.latitude, oltLocationForm.longitude, current));
    setOltLocationPickerOpen(true);
  }

  function updateOltLocationPickerZoom(delta) {
    const maxZoom = Math.max(10, maxNativeTileZoomForMode(activeTileProvider));
    setOltLocationPickerView((current) => ({
      ...current,
      zoom: clamp(Math.round((Number(current.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom) + delta), 10, maxZoom)
    }));
  }

  function captureOltLocationAtPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const zoom = clamp(Math.round(Number(oltLocationPickerView.zoom) || DEFAULT_OLT_LOCATION_PICKER.zoom), 10, Math.max(10, maxNativeTileZoomForMode(activeTileProvider)));
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
    setFiberMappingLayoutContainerKey('');
    setFiberLinkCanvasPonId('');
    setFiberLineReturnPonId('');
    setFiberLinkSettingsReturnPonId('');
    setFiberLayoutReturnPonId('');
    setFiberLayoutIncomingEdgeId('');
    setFiberLinkSettingsError('');
    resetPonFiberLinkCanvasView();
    setFiberDeleteTarget(null);
    setFiberSplitterAddDraft(null);
    setFiberLineFormError('');
    resetFiberLayoutModalView();
    setPonPowerOlt(null);
    setDeviceFormError('');
    setDeviceSaving(false);
    setNapSelectedOltId('');
    setNapAddAnother(false);
    setNapFormError('');
    setNapSaving(false);
    setSplitterManufacturerAdding(false);
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
    const usedPorts = new Set(pons.filter((pon) => pon.oltId === nextOltId).map((pon) => Number(pon.portNumber)));
    let nextPort = 1;
    while (usedPorts.has(nextPort)) nextPort += 1;
    setPonForm({
      ...blankPon,
      portNumber: nextOltId ? String(nextPort) : '',
      colorHex: defaultPonColor(nextPort, meta.ponColorPalette)
    });
    setModalType('pon');
  }

  function openEditPon(pon) {
    setSelectedOltId(pon.oltId);
    setExpandedOltIds((current) => ({ ...current, [pon.oltId]: true }));
    setPonForm({ ...blankPon, ...pon, portNumber: String(pon.portNumber), capacity: String(pon.capacity), colorHex: ponColor(pon, meta.ponColorPalette) });
    setModalType('pon');
  }

  function openPonPower(pon) {
    setSelectedOltId(pon.oltId);
    setExpandedOltIds((current) => ({ ...current, [pon.oltId]: true }));
    setPonForm({ ...blankPon, ...pon, portNumber: String(pon.portNumber), capacity: String(pon.capacity), moduleSource: pon.moduleSource || 'Manual' });
    setModalType('pon-power');
  }

  function openOltPonPower(olt) {
    setSelectedOltId(olt.id);
    setExpandedOltIds((current) => ({ ...current, [olt.id]: true }));
    setPonPowerOlt(olt);
    setPonForm({ ...blankPon, label: `${olt.name} PONs`, moduleVendor: '', moduleRxPowerDbm: '', moduleSource: 'Manual' });
    setModalType('olt-pon-power');
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
    setNapFormError('');
    setNapSaving(false);
    setModalType('nap');
    loadBarangayOptions();
  }

  function selectNapOlt(oltId) {
    setNapSelectedOltId(oltId);
    setNapFormError('');
    setNapForm((current) => {
      const currentPonStillAvailable = pons.some((pon) => pon.id === current.ponPortId && pon.oltId === oltId);
      return { ...current, ponPortId: currentPonStillAvailable ? current.ponPortId : '' };
    });
  }

  function selectNapPon(ponPortId) {
    setNapFormError('');
    setNapForm((current) => ({ ...current, ponPortId }));
  }

  function openNewFbt(type = splitterTab) {
    const splitterType = normalizeSplitterType(type);
    const defaults = splitterDefaultsForType(splitterType);
    const ratioProfiles = isPortLossSplitterType(splitterType)
      ? normalizeSplitterRatioProfiles(splitterType, [], defaults.splitRatio, [], '', ratioOptionsForSplitterType(splitterType, meta))
      : [];
    setFbtForm({
      ...blankFbt,
      ...defaults,
      splitterType,
      ratioRows: splitterType === 'FBT' ? defaultFbtRatioRows(meta.fbtSplitRatios || defaultMeta.fbtSplitRatios) : [],
      visibleWavelengths: [...defaultMeta.wavelengthsNm],
      ratioProfiles,
      portLosses: ratioProfiles[0]?.portLosses || (isPortLossSplitterType(splitterType) ? makeSplitterPortLossRows(defaults.splitRatio) : [])
    });
    setSplitterManufacturerAdding(false);
    setModalType('fbt');
  }

  function openEditFbt(fbt) {
    const splitterType = normalizeSplitterType(fbt.splitterType);
    const defaultRatios = meta.fbtSplitRatios || defaultMeta.fbtSplitRatios;
    const defaults = splitterDefaultsForType(splitterType);
    const ratioProfiles = isPortLossSplitterType(splitterType)
      ? normalizeSplitterRatioProfiles(splitterType, fbt.ratioProfiles, fbt.splitRatio || defaults.splitRatio, fbt.portLosses, fbt.insertionLossDb, ratioOptionsForSplitterType(splitterType, meta))
      : [];
    setFbtForm({
      ...blankFbt,
      ...defaults,
      ...fbt,
      splitterType,
      manufacturer: fbt.manufacturer || fbt.brand || '',
      brand: fbt.manufacturer || fbt.brand || '',
      portNumber: String(fbt.portNumber || ''),
      inputPorts: String(fbt.inputPorts || defaults.inputPorts),
      outputPorts: String(fbt.outputPorts || fbt.portCapacity || defaults.outputPorts),
      portCapacity: String(fbt.portCapacity || fbt.outputPorts || defaults.portCapacity),
      ratioRows: splitterType === 'FBT' ? normalizeFbtRatioRows(fbt.ratioRows, fbt.splitRatio, defaultRatios, fbt) : [],
      visibleWavelengths: [...defaultMeta.wavelengthsNm],
      ratioProfiles,
      portLosses: ratioProfiles[0]?.portLosses || (isPortLossSplitterType(splitterType) ? makeSplitterPortLossRows(fbt.splitRatio || defaults.splitRatio, fbt.portLosses, fbt.insertionLossDb) : [])
    });
    setSplitterManufacturerAdding(false);
    setModalType('fbt');
  }

  function changeSplitterType(type) {
    const splitterType = normalizeSplitterType(type);
    const defaults = splitterDefaultsForType(splitterType);
    setSplitterManufacturerAdding(false);
    setFbtForm((current) => {
      const ratioProfiles = isPortLossSplitterType(splitterType)
        ? normalizeSplitterRatioProfiles(splitterType, [], defaults.splitRatio, current.portLosses, current.insertionLossDb, ratioOptionsForSplitterType(splitterType, meta))
        : [];
      return {
        ...current,
        ...defaults,
        splitterType,
        name: current.name,
        napBoxId: current.napBoxId,
        portNumber: current.portNumber,
        manufacturer: current.manufacturer || current.brand,
        brand: current.manufacturer || current.brand,
        model: current.model,
        serialNumber: current.serialNumber,
        status: current.status,
        locationHint: current.locationHint,
        notes: current.notes,
        ratioRows: splitterType === 'FBT' ? normalizeFbtRatioRows(current.ratioRows, current.splitRatio, meta.fbtSplitRatios || defaultMeta.fbtSplitRatios, current) : [],
        visibleWavelengths: [...defaultMeta.wavelengthsNm],
        ratioProfiles,
        portLosses: ratioProfiles[0]?.portLosses || (isPortLossSplitterType(splitterType) ? makeSplitterPortLossRows(defaults.splitRatio, current.portLosses, current.insertionLossDb) : [])
      };
    });
  }

  function changePortLossSplitRatio(splitRatio) {
    const outputPorts = splitterOutputPortsFromRatio(splitRatio, 1);
    setFbtForm((current) => ({
      ...current,
      splitRatio,
      inputPorts: '1',
      outputPorts: String(outputPorts),
      portCapacity: String(outputPorts),
      portLosses: makeSplitterPortLossRows(splitRatio, current.portLosses, current.insertionLossDb)
    }));
  }

  function openNewFiberOptic() {
    setFiberOpticForm(makeBlankFiberOptic(fiberColorSettings));
    setFiberOpticFormError('');
    setModalType('fiber-optic');
  }

  function openEditFiberOptic(profile) {
    setFiberOpticForm(normalizeFiberOpticForm(profile, fiberColorSettings));
    setFiberOpticFormError('');
    setModalType('fiber-optic');
  }

  function changeFiberCoreCount(coreCount) {
    setFiberOpticForm((current) => {
      const count = normalizeFiberCoreCount(coreCount, Number(current.coreCount) || 12);
      return {
        ...current,
        coreCount: String(count),
        colorGroups: buildFiberColorGroups(count, fiberColorSettings, current.colorGroups)
      };
    });
  }

  function changeFiberColorGroups(colorGroups) {
    const coreCount = fiberCoreCountFromGroups(colorGroups);
    setFiberOpticForm((current) => ({
      ...current,
      coreCount: String(normalizeFiberCoreCount(coreCount, Number(current.coreCount) || 12)),
      colorGroups
    }));
  }

  async function saveFiberColorSettings() {
    setFiberSettingsSaving(true);
    try {
      const saved = await request('/network-settings/fiber-optic-settings', {
        method: 'PATCH',
        body: JSON.stringify(normalizeFiberColorSettings(fiberColorDraft))
      });
      const nextSettings = normalizeFiberColorSettings(saved.colorSettings);
      setFiberColorSettings(nextSettings);
      setFiberColorDraft(nextSettings);
      setMessage('Fiber color settings saved.');
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    } finally {
      setFiberSettingsSaving(false);
    }
  }

  function resetFiberColorSettingsDraft() {
    setFiberColorDraft(defaultFiberColorSettings);
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
      apiPassword: device.apiPassword || '',
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
        setMessage(`${saved.name} OLT mapping location saved.`);
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

  async function savePonColor(pon, value) {
    const colorHex = normalizeHexColor(value, ponColor(pon, meta.ponColorPalette));
    setPonColorSavingId(pon.id);
    setPons((current) => current.map((row) => (row.id === pon.id ? { ...row, colorHex } : row)));
    try {
      const saved = await request(`/network-settings/pons/${pon.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ colorHex })
      });
      setPons((current) => current.map((row) => (row.id === pon.id ? { ...row, ...saved } : row)));
      setMessage(`${saved.label || pon.label} color saved.`);
    } catch (err) {
      setMessage(`PON color was not saved: ${err.message}`);
      await load();
    } finally {
      setPonColorSavingId('');
    }
  }

  async function savePonPower(event) {
    event.preventDefault();
    if (!ponForm.id) return;
    const body = {
      moduleVendor: ponForm.moduleVendor,
      moduleRxPowerDbm: ponForm.moduleRxPowerDbm,
      moduleSource: 'Manual'
    };
    await request(`/network-settings/pons/${ponForm.id}/power`, { method: 'PATCH', body: JSON.stringify(body) });
    setMessage('PON power saved.');
    closeModal();
    await load();
    refreshShell();
  }

  async function saveOltPonPower(event) {
    event.preventDefault();
    if (!ponPowerOlt?.id) return;
    const body = {
      moduleVendor: ponForm.moduleVendor,
      moduleRxPowerDbm: ponForm.moduleRxPowerDbm,
      moduleSource: 'Manual'
    };
    const saved = await request(`/network-settings/olts/${ponPowerOlt.id}/pons/power`, { method: 'PATCH', body: JSON.stringify(body) });
    setMessage(`PON power saved for ${saved.updatedPons || 0} PONs.`);
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
        setMessage(`${successMessage} Add another NAP for ${retainedPon ? ponPathLabel(retainedPon, olts) : 'the selected PON'}.`);
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
    const optionalNumber = (value) => (value === '' || value === null || value === undefined ? null : Number(value));
    const outputPorts = optionalNumber(fbtForm.outputPorts);
    const splitterType = normalizeSplitterType(fbtForm.splitterType);
    const ratioRows = splitterType === 'FBT'
      ? compactFbtRatioRows(clearUncheckedFbtWavelengths(
        normalizeFbtRatioRows(fbtForm.ratioRows, fbtForm.splitRatio, meta.fbtSplitRatios || defaultMeta.fbtSplitRatios, fbtForm),
        fbtForm.visibleWavelengths
      ))
      : [];
    const ratioProfiles = isPortLossSplitterType(splitterType)
      ? compactSplitterRatioProfiles(
        splitterType,
        fbtForm.ratioProfiles,
        fbtForm.splitRatio,
        fbtForm.portLosses,
        fbtForm.insertionLossDb,
        ratioOptionsForSplitterType(splitterType, meta)
      )
      : [];
    const primaryRatioProfile = ratioProfiles[0] || null;
    const primaryPortLosses = primaryRatioProfile?.portLosses || [];
    const primarySplitRatio = primaryRatioProfile?.splitRatio || fbtForm.splitRatio;
    const portLossOutputPorts = splitterOutputPortsFromRatio(primarySplitRatio, outputPorts || 1);
    const body = {
      ...fbtForm,
      splitterType,
      ratioRows,
      ratioProfiles,
      portLosses: primaryPortLosses,
      splitRatio: splitterType === 'FBT' ? (ratioRows[0]?.ratio || '5:95') : primarySplitRatio,
      inputPorts: optionalNumber(fbtForm.inputPorts),
      outputPorts,
      portNumber: optionalNumber(fbtForm.portNumber),
      portCapacity: outputPorts
    };
    if (body.splitterType === 'FBT') {
      body.inputPorts = 1;
      body.outputPorts = 2;
      body.portCapacity = 2;
    }
    if (isPortLossSplitterType(body.splitterType)) {
      body.inputPorts = 1;
      body.outputPorts = portLossOutputPorts;
      body.portCapacity = portLossOutputPorts;
      body.insertionLossDb = primaryPortLosses.find((row) => row.insertionLossDb)?.insertionLossDb || '';
    }
    if (body.splitterType !== 'LCP' || isPortLossSplitterType(body.splitterType)) {
      body.lcpCabinet = '';
      body.lcpSlot = '';
    }
    delete body.id;
    delete body.visibleWavelengths;
    await request(fbtForm.id ? `/network-settings/fbts/${fbtForm.id}` : '/network-settings/fbts', {
      method: fbtForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    setSplitterTab(body.splitterType);
    setMessage(`${titleize(body.splitterType)} splitter saved.`);
    closeModal();
    await load();
    refreshShell();
  }

  async function saveFiberOptic(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setFiberOpticFormError('');
    const manufacturer = String(fiberOpticForm.manufacturer || '').trim();
    const model = String(fiberOpticForm.model || '').trim();
    const draft = { ...fiberOpticForm, manufacturer, model };
    if (!manufacturer) {
      setFiberOpticFormError('Manufacturer / company is required.');
      return;
    }
    if (!hasFiberOpticLossValue(draft)) {
      setFiberOpticFormError('Enter at least one wavelength loss value.');
      return;
    }
    const coreCount = normalizeFiberCoreCount(fiberOpticForm.coreCount, fiberCoreCountFromGroups(fiberOpticForm.colorGroups) || 12);
    const body = {
      ...draft,
      name: buildFiberOpticDisplayName(draft, coreCount),
      fiberType: '',
      coreCount,
      colorGroups: buildFiberColorGroups(coreCount, fiberColorSettings, draft.colorGroups)
    };
    delete body.id;
    try {
      await request(
        fiberOpticForm.id ? `/network-settings/fiber-optic-losses/${fiberOpticForm.id}` : '/network-settings/fiber-optic-losses',
        {
          method: fiberOpticForm.id ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        }
      );
      setMessage('Fiber optic insertion loss profile saved.');
      closeModal();
      await load();
      refreshShell();
    } catch (err) {
      setFiberOpticFormError(err.message);
    }
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

  function canDragDeviceOrder(device) {
    return activeSection === 'olt-settings' && isSnmpOltDevice(device);
  }

  function orderedSnmpOltDevices(rows = devices) {
    return rows.filter(isSnmpOltDevice).sort(sortByDisplayOrder);
  }

  function startDeviceOrderDrag(event, device) {
    if (!canDragDeviceOrder(device)) return;
    setDeviceOrderError('');
    setDeviceOrderDraggingId(device.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', device.id);
  }

  function overDeviceOrderDrag(event, device) {
    if (!canDragDeviceOrder(device) || deviceOrderSaving) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  async function dropDeviceOrder(event, targetDevice) {
    if (!canDragDeviceOrder(targetDevice) || deviceOrderSaving) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = deviceOrderDraggingId || event.dataTransfer.getData('text/plain');
    setDeviceOrderDraggingId('');
    if (!sourceId || sourceId === targetDevice.id) return;
    const orderedRows = orderedSnmpOltDevices();
    const sourceIndex = orderedRows.findIndex((device) => device.id === sourceId);
    const targetIndex = orderedRows.findIndex((device) => device.id === targetDevice.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextRows = [...orderedRows];
    const [moved] = nextRows.splice(sourceIndex, 1);
    nextRows.splice(targetIndex, 0, moved);
    setDeviceOrderSaving(true);
    setDeviceOrderError('');
    try {
      const saved = await request('/network-settings/devices/order', {
        method: 'PATCH',
        body: JSON.stringify({
          accessMethod: 'SNMP',
          deviceType: 'OLT',
          orderedIds: nextRows.map((device) => device.id)
        })
      });
      setDevices([...(saved.devices || [])].sort(sortNetworkDeviceRows));
      if (Array.isArray(saved.olts)) setOlts([...saved.olts].sort(sortByDisplayOrder));
      setMessage('OLT display order saved. Network Topology tabs updated.');
      refreshShell();
    } catch (err) {
      setDeviceOrderError(err.message);
    } finally {
      setDeviceOrderSaving(false);
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
      ['Splitters', overview.metrics.splitters ?? overview.metrics.fbts, IconNetwork, 'green']
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
                  <thead><tr><th>OLT</th><th>Status</th><th>PON</th><th>NAP</th><th>Splitters</th></tr></thead>
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
    const showApiPasswordColumn = deviceScope.accessMethod === 'API';
    const canOrderOltRows = activeSection === 'olt-settings' && deviceScope.accessMethod === 'SNMP' && deviceScope.deviceType === 'OLT';
    const emptyColSpan = (showApiPasswordColumn ? 8 : 7) + (canOrderOltRows ? 1 : 0);
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
              {canOrderOltRows && (
                <div className="network-device-order-note">
                  <span>Drag OLT rows top to bottom. The first row becomes the first Network Topology tab.</span>
                  {deviceOrderSaving && <strong>Saving order...</strong>}
                </div>
              )}
              {deviceOrderError && <div className="alert alert-danger mb-3">{deviceOrderError}</div>}
              <div className="table-responsive">
                <table className="table card-table table-vcenter network-table network-device-table">
                  <thead>
                    <tr>
                      {canOrderOltRows && <th className="network-device-drag-column" aria-label="Reorder" />}
                      <th>Device</th>
                      <th>Endpoint</th>
                      {showApiPasswordColumn && <th>API Password</th>}
                      <th>Type</th>
                      <th>Vendor</th>
                      <th>Status</th>
                      <th>Polling</th>
                      <th className="network-actions-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.map((device) => (
                      <tr
                        key={device.id}
                        draggable={canOrderOltRows}
                        className={deviceOrderDraggingId === device.id ? 'network-device-row-dragging' : ''}
                        onDragStart={(event) => startDeviceOrderDrag(event, device)}
                        onDragOver={(event) => overDeviceOrderDrag(event, device)}
                        onDrop={(event) => dropDeviceOrder(event, device)}
                        onDragEnd={() => setDeviceOrderDraggingId('')}
                      >
                        {canOrderOltRows && (
                          <td className="network-device-drag-column">
                            <span className="network-device-drag-handle" title="Drag to reorder Network Topology tabs" aria-hidden="true">
                              <span className="network-device-drag-dots" />
                            </span>
                          </td>
                        )}
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
                              {device.hasOltMapLocation ? `Mapping ${device.latitude}, ${device.longitude}` : 'No OLT mapping location'}
                            </div>
                          )}
                        </td>
                        <td>{device.connectionLabel}<span>{device.accessMethod === 'API' ? device.apiProtocol : `${titleize(device.snmpVersion)} / ${titleize(device.snmpTransport)} / ${titleize(device.portAssociationMode)}`}</span></td>
                        {showApiPasswordColumn && (
                          <td>
                            <span className="network-table-value font-monospace">{device.apiPassword || '-'}</span>
                            <span>{device.apiUsername ? `User ${device.apiUsername}` : 'No API username'}</span>
                          </td>
                        )}
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
                              title: `Set OLT mapping location for ${device.name}`,
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
                    {!filteredDevices.length && <tr><td colSpan={emptyColSpan}><div className="empty">{deviceScope.emptyMessage}</div></td></tr>}
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
                            <RowActions
                              label={olt.name}
                              onEdit={() => openEditOlt(olt)}
                              onDelete={() => remove(`/network-settings/olts/${olt.id}`, olt.name)}
                              extraActions={[{
                                label: 'power-all',
                                title: `Add PON power to all PONs for ${olt.name}`,
                                icon: IconAntenna,
                                className: 'bg-cyan-lt text-cyan',
                                onClick: () => openOltPonPower(olt)
                              }]}
                            />
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
                                      <thead><tr><th>PON</th><th>Color</th><th>Status</th><th>Power Module</th><th>Split/VLAN</th><th>Capacity</th><th>ONUs</th><th>NAP</th><th className="network-actions-column">Actions</th></tr></thead>
                                      <tbody>
                                        {oltPons.map((pon) => {
                                          const ponOnus = onusForPon(pon.id);
                                          const onlineCount = ponOnus.filter((onu) => onu.status === 'ONLINE').length;
                                          return (
                                            <tr key={pon.id}>
                                              <td><span className="network-table-value fw-semibold">{pon.label}</span><div className="text-muted small">Port {pon.portNumber} / {pon.technology}</div></td>
                                              <PonColorCell pon={pon} palette={meta.ponColorPalette} saving={ponColorSavingId === pon.id} onChange={savePonColor} />
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
                                        {!oltPons.length && <tr><td colSpan="9"><div className="empty">No PON records for this OLT.</div></td></tr>}
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

  function shouldHighlightServiceabilityPort(nap, assignment) {
    if (!nap?.customerMapped || !nap.mappedPortNumber) return false;
    if (nap.mappedSplitterAssignmentId) return sameServiceabilityId(nap.mappedSplitterAssignmentId, assignment.assignmentId);
    if (nap.mappedSplitterId) return sameServiceabilityId(nap.mappedSplitterId, assignment.splitterId);
    const assignments = nap.topology?.splitterAssignments || [];
    return assignments.length === 1 || nap.topology?.primarySplitter?.assignmentId === assignment.assignmentId;
  }

  function renderServiceabilitySplitterAssignment(assignment, nap) {
    const splitter = assignment.splitter || {};
    const splitterType = normalizeSplitterType(splitter.splitterType);
    const makerModel = [splitter.manufacturer || splitter.brand, splitter.model || splitter.name].filter(Boolean).join(' / ') || 'Configured splitter';
    const display = plcSplitterDisplayFor(assignment);
    const highlightedPortNumber = shouldHighlightServiceabilityPort(nap, assignment) ? Number(nap.mappedPortNumber || 0) : 0;
    const outputPorts = assignment.outputPorts || display?.outputPorts || Number(splitter.outputPorts || splitter.portCapacity || 0);
    const mappedLoss = highlightedPortNumber
      ? assignment.portLosses?.find((row) => Number(row.portNumber) === highlightedPortNumber)?.insertionLossDb
      : '';
    if (display) {
      return (
        <div className="network-serviceability-splitter-card plc" key={assignment.assignmentId}>
          <div className="network-serviceability-splitter-card-header">
            <span className={`badge bg-${splitterType === 'LCP' ? 'purple' : 'blue'}-lt text-${splitterType === 'LCP' ? 'purple' : 'blue'}`}>{splitterType}</span>
            <strong>{makerModel}</strong>
          </div>
          <div className="network-serviceability-splitter-equipment">
            {renderPlcSplitterSvg(display, { highlightedPortNumber })}
          </div>
          <div className="network-serviceability-splitter-meta">
            <span>{display.ratioLabel}</span>
            <span>{outputPorts} output ports</span>
            {highlightedPortNumber ? <span className="mapped">Mapped port {highlightedPortNumber}{mappedLoss ? ` / ${mappedLoss} dB` : ''}</span> : <span>Technician port mapping pending</span>}
          </div>
        </div>
      );
    }
    return (
      <div className="network-serviceability-splitter-card compact" key={assignment.assignmentId}>
        <div className="network-serviceability-splitter-card-header">
          <span className={`badge bg-${splitterType === 'FBT' ? 'green' : 'secondary'}-lt text-${splitterType === 'FBT' ? 'green' : 'secondary'}`}>{splitterType}</span>
          <strong>{makerModel}</strong>
        </div>
        <div className="network-serviceability-splitter-meta">
          <span>{splitterType === 'FBT' ? formatFbtRatio(assignment.ratio || splitter.splitRatio) : formatSplitterRatio(assignment.ratio || splitter.splitRatio)}</span>
          <span>{outputPorts || '-'} output ports</span>
        </div>
      </div>
    );
  }

  function renderServiceabilityPage() {
    const napMarkerImage = mapImageFor('nap');
    const selectedCustomer = selectedServiceabilityCustomer;
    const selectedNap = serviceabilityMap.selectedNap;
    const detailNap = serviceabilityMap.napNodes.find((node) => node.sourceId === serviceabilityNapDetailId) || null;
    const link = serviceabilityMap.link;
    const serviceable = link?.status === 'connected';
    const napOptions = [...serviceabilityMap.napNodes].sort((left, right) => {
      if (left.serviceable !== right.serviceable) return left.serviceable ? -1 : 1;
      const leftDistance = Number.isFinite(left.distanceMeters) ? left.distanceMeters : Number.MAX_SAFE_INTEGER;
      const rightDistance = Number.isFinite(right.distanceMeters) ? right.distanceMeters : Number.MAX_SAFE_INTEGER;
      return leftDistance - rightDistance || left.label.localeCompare(right.label);
    });
    const disconnectedSegments = link && !serviceable ? serviceabilityCutLineSegments(link.nap, link.house) : [];
    const activeServiceabilityProvider = serviceabilityMap.tileProvider || selectedMapProvider;
    const activeServiceabilityProviderLabel = activeServiceabilityProvider?.label || 'Map';
    const statusCounts = serviceabilityAllCustomerRows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
    const serviceabilityStatuses = ['MAPPED', 'SERVICEABLE', 'NO_PORTS', 'NEEDS_COORDINATES', 'NO_NAP'];
    const selectedLocationLabel = serviceabilityLocationLabel(selectedCustomer);

    const mapSurface = (
      <div
        ref={serviceabilitySurfaceRef}
        className={`network-map-surface network-serviceability-surface ${serviceabilityDragging ? 'dragging' : ''}`}
        onMouseDown={startServiceabilityPan}
        onMouseMove={moveServiceabilityPan}
        onMouseUp={endServiceabilityPan}
        onMouseLeave={() => {
          serviceabilityDragRef.current = null;
          setServiceabilityDragging(false);
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomServiceabilityAt(event.deltaY < 0 ? SERVICEABILITY_MAP_WHEEL_ZOOM_FACTOR : 1 / SERVICEABILITY_MAP_WHEEL_ZOOM_FACTOR, event.clientX, event.clientY);
        }}
      >
        <div className="network-map-toolbar network-serviceability-toolbar" onMouseDown={(event) => event.stopPropagation()}>
          <div className="network-map-title">
            <span className="badge bg-blue-lt text-blue"><IconHomeSignal size={18} /></span>
            <div>
              <strong>{selectedCustomer ? customerDisplayName(selectedCustomer) : 'Serviceability Check'}</strong>
              <span>
                {activeServiceabilityProviderLabel} z{serviceabilityMap.tileZoom}{mapHighDetail ? ' HD' : ''}{serviceabilityMap.nativeTileMaxed ? ' max' : ''}
              </span>
            </div>
          </div>
          <div className="network-map-controls network-serviceability-controls">
            <div className="network-serviceability-map-menu-shell">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm network-serviceability-map-menu-button"
                onClick={() => setServiceabilityMapMenuOpen((current) => !current)}
                aria-expanded={serviceabilityMapMenuOpen}
              >
                <IconMap size={16} />
                <span>{activeServiceabilityProviderLabel}</span>
                <IconChevronDown size={14} />
              </button>
              {serviceabilityMapMenuOpen && (
                <div className="network-serviceability-map-menu" role="menu">
                  {mapProviderOptions.map((provider) => {
                    const isActive = provider.id === activeMapProviderId;
                    return (
                      <button
                        type="button"
                        key={provider.id}
                        className={`network-serviceability-map-option ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setMapTileMode(provider.id);
                          setServiceabilityMapMenuOpen(false);
                        }}
                      >
                        <span>
                          <strong>{provider.label}</strong>
                          <small>{mapProviderTypeLabel(provider.type)}</small>
                        </span>
                        {isActive && <IconCircleCheck size={16} />}
                      </button>
                    );
                  })}
                  {mapProviderNeedsSession(selectedMapProvider) && !mapProviderSession && !mapProviderSessionError && (
                    <small className="network-map-provider-session-note">Starting Google map session...</small>
                  )}
                  {mapProviderSessionError && (
                    <small className="network-map-provider-session-error">{mapProviderSessionError}</small>
                  )}
                </div>
              )}
            </div>
            <button type="button" className={`btn btn-sm network-map-hd-toggle ${mapHighDetail ? 'btn-primary' : 'btn-outline-secondary'}`} title="Toggle higher detail map tiles" onClick={() => setMapHighDetail((current) => !current)}>
              HD
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomServiceabilityAt(1 / SERVICEABILITY_MAP_BUTTON_ZOOM_FACTOR)}>
              <IconZoomOut size={16} />
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm network-map-zoom-value" title="Reset serviceability map view" onClick={resetServiceabilityView}>
              z{serviceabilityMap.viewZoom.toFixed(1)}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomServiceabilityAt(SERVICEABILITY_MAP_BUTTON_ZOOM_FACTOR)}>
              <IconZoomIn size={16} />
            </button>
          </div>
        </div>
        <div
          className={`network-map-tile-layer network-serviceability-tile-layer ${serviceabilityHasReadyFallback ? 'has-ready-fallback' : ''} ${serviceabilityCurrentTilesReady ? 'ready' : 'loading'}`}
          aria-hidden="true"
        >
          {serviceabilityHasReadyFallback && (
            <div className="network-serviceability-ready-tile-layer">
              {serviceabilityReadyTiles.map((tile) => (
                <img
                  key={`ready-${tile.id}`}
                  src={tile.src}
                  alt=""
                  draggable="false"
                  loading="eager"
                  decoding="async"
                  style={{ left: tile.x, top: tile.y, width: tile.size, height: tile.size }}
                />
              ))}
            </div>
          )}
          <div className="network-serviceability-current-tile-layer">
            {serviceabilityMap.tiles.map((tile) => {
              const tileLoaded = Boolean(serviceabilityLoadedTileIds[tile.id]);
              return (
                <img
                  key={tile.id}
                  src={tile.src}
                  alt=""
                  draggable="false"
                  loading="eager"
                  decoding="async"
                  className={tileLoaded ? 'loaded' : 'loading'}
                  onLoad={() => markServiceabilityTileLoaded(tile.id)}
                  onError={() => markServiceabilityTileLoaded(tile.id)}
                  style={{ left: tile.x, top: tile.y, width: tile.size, height: tile.size }}
                />
              );
            })}
          </div>
        </div>
        <svg className="network-serviceability-link-layer" viewBox={`0 0 ${serviceabilityMap.surface.width} ${serviceabilityMap.surface.height}`}>
          {link && serviceable && (
            <g className="network-serviceability-line connected">
              <path d={link.path} />
              <circle r="6">
                <animateMotion dur="1.8s" repeatCount="indefinite" path={link.path} />
              </circle>
            </g>
          )}
          {link && !serviceable && (
            <g className="network-serviceability-line disconnected">
              {disconnectedSegments.map((segment, index) => <path key={index} d={mapLinkPath(segment)} />)}
            </g>
          )}
        </svg>
        {link && !serviceable && (
          <span className="network-serviceability-no-service" style={{ left: link.midpoint.x, top: link.midpoint.y }}>
            <IconHomeOff size={20} />
          </span>
        )}
        <div className="network-map-marker-layer network-serviceability-marker-layer">
          {serviceabilityMap.napNodes.map((node) => {
            const markerStyle = {
              left: node.x,
              top: node.y,
              '--network-map-marker-color': node.ponColorHex
            };
            return (
              <button
                type="button"
                key={node.id}
                className={`network-map-marker network-serviceability-marker nap ${node.customerMapped ? 'mapped' : node.serviceable ? 'available' : 'unavailable'} ${selectedNap?.sourceId === node.sourceId ? 'selected' : ''}`}
                style={markerStyle}
                title={node.customerMapped ? `${node.label} - mapped customer NAP` : `${node.label} - ${node.remainingPorts}/${node.capacity} ports remaining`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setServiceabilitySelectedNapId(node.sourceId);
                  setServiceabilityNapDetailId(node.sourceId);
                }}
              >
                <span className="network-map-marker-art">
                  {napMarkerImage ? <img src={napMarkerImage} alt="" /> : <IconBox size={24} />}
                </span>
                <span className="network-serviceability-port-badge">{node.customerMapped ? 'Mapped' : `${node.remainingPorts}/${node.capacity}`}</span>
                <span className="network-map-marker-label"><strong>{node.label}</strong></span>
              </button>
            );
          })}
          {serviceabilityMap.houseNode && (
            <span className={`network-serviceability-house-marker ${serviceable ? 'connected' : 'disconnected'}`} style={{ left: serviceabilityMap.houseNode.x, top: serviceabilityMap.houseNode.y }}>
              <span><IconHome size={25} /></span>
              <strong>{serviceabilityMap.houseNode.label}</strong>
            </span>
          )}
        </div>
        {detailNap && (
          <aside className="network-serviceability-nap-detail" onMouseDown={(event) => event.stopPropagation()}>
            <div className="network-serviceability-nap-detail-header">
              <span><IconBox size={18} /></span>
              <div>
                <small>NAP Box</small>
                <strong>{detailNap.label}</strong>
              </div>
              <button type="button" className="btn btn-outline-secondary btn-sm network-header-icon-button" aria-label="Close NAP details" onClick={() => setServiceabilityNapDetailId('')}>
                <IconX size={15} />
              </button>
            </div>
            <div className="network-serviceability-nap-detail-grid">
              <span><small>Status</small><strong>{detailNap.customerMapped ? 'Mapped' : detailNap.serviceable ? 'Available' : 'No Ports'}</strong></span>
              <span><small>Remaining Ports</small><strong>{detailNap.remainingPorts}/{detailNap.capacity}</strong></span>
              <span><small>Distance</small><strong>{formatDistanceMeters(detailNap.distanceMeters)}</strong></span>
              <span><small>PON Path</small><strong>{detailNap.detail || '-'}</strong></span>
              <span><small>Barangay</small><strong>{detailNap.sourceNap?.barangay || '-'}</strong></span>
              <span><small>OLT</small><strong>{detailNap.sourceNap?.oltName || '-'}</strong></span>
            </div>
            <div className="network-serviceability-splitter-section">
              <div className="network-serviceability-splitter-section-header">
                <small>Topology Splitters</small>
                <strong>{detailNap.topology?.splitterAssignments?.length || 0}</strong>
              </div>
              {detailNap.topology?.splitterAssignments?.length ? (
                <div className="network-serviceability-splitter-list">
                  {detailNap.topology.splitterAssignments.map((assignment) => renderServiceabilitySplitterAssignment(assignment, detailNap))}
                </div>
              ) : (
                <div className="network-serviceability-splitter-empty">No splitter assigned to this NAP in Network Topology.</div>
              )}
            </div>
            <small className="network-map-legend-source">{serviceabilityMap.tileAttribution}</small>
          </aside>
        )}
        {!serviceabilityMap.napNodes.length && (
          <div className="network-map-empty">
            No NAP boxes with coordinates match {selectedCustomer ? selectedLocationLabel : 'this customer location'}.
          </div>
        )}
        {selectedCustomer && !rowCoordinates(selectedCustomer) && (
          <div className="network-map-empty">
            This customer has no latitude and longitude saved.
          </div>
        )}
      </div>
    );

    if (!selectedCustomer) {
      return (
        <div className="network-serviceability-directory">
          <div className="network-serviceability-summary-grid">
            {[
              ['Customers', serviceabilityAllCustomerRows.length, 'blue'],
              ['Mapped', statusCounts.MAPPED || 0, 'blue'],
              ['Serviceable', statusCounts.SERVICEABLE || 0, 'green'],
              ['No Ports', statusCounts.NO_PORTS || 0, 'red'],
              ['Needs Coordinates', statusCounts.NEEDS_COORDINATES || 0, 'yellow']
            ].map(([label, value, tone]) => (
              <div className="card network-serviceability-summary-card" key={label}>
                <div className="card-body">
                  <span className={`badge bg-${tone}-lt text-${tone}`}>{label}</span>
                  <strong>{value}</strong>
                </div>
              </div>
            ))}
          </div>
          <Card
            title="Serviceability Check"
            icon={IconHomeSignal}
            className="network-serviceability-table-card"
            actions={(
              <div className="network-serviceability-table-actions">
                <SearchInput value={serviceabilitySearch} onChange={setServiceabilitySearch} placeholder="Search customer, account, address, NAP" />
                <select className="form-select form-select-sm" value={serviceabilityStatusFilter} onChange={(event) => setServiceabilityStatusFilter(event.target.value)}>
                  <option value="">All Statuses</option>
                  {serviceabilityStatuses.map((status) => {
                    const meta = serviceabilityStatusMeta(status);
                    return <option key={status} value={status}>{meta.label}</option>;
                  })}
                </select>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
                  <IconRefresh size={16} className="me-2" />Refresh
                </button>
              </div>
            )}
          >
            <div className="table-responsive">
              <table className="table card-table table-vcenter network-serviceability-customer-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Recommended NAP</th>
                    <th>Distance</th>
                    <th>Ports</th>
                    <th>Address</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceabilityCustomerRows.map((row) => {
                    const RowIcon = row.statusMeta.icon;
                    return (
                      <tr key={row.customer.id} className="network-serviceability-customer-row" onClick={() => selectServiceabilityCustomer(row.customer.id)}>
                        <td>
                          <div className="network-serviceability-customer-main">
                            <strong>{customerDisplayName(row.customer)}</strong>
                            <span>{row.customer.accountNumber || row.customer.contactNumber || '-'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge bg-${row.statusMeta.tone}-lt text-${row.statusMeta.tone}`}>
                            <RowIcon size={14} className="me-1" />{row.statusMeta.label}
                          </span>
                        </td>
                        <td>{row.recommendedNap?.label || '-'}</td>
                        <td>{row.recommendedNap ? formatDistanceMeters(row.recommendedNap.distanceMeters) : '-'}</td>
                        <td>{formatServiceabilityPorts(row.recommendedNap)}</td>
                        <td className="network-serviceability-address-cell">{customerServiceAddress(row.customer) || row.customer.locationName || '-'}</td>
                        <td className="text-end">
                          <button type="button" className="btn btn-primary btn-sm" onClick={(event) => { event.stopPropagation(); selectServiceabilityCustomer(row.customer.id); }}>
                            Check
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!serviceabilityCustomerRows.length && (
                    <tr>
                      <td colSpan="7"><div className="empty">No customers match the current serviceability filters.</div></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="network-serviceability-split-page">
        <aside className="network-serviceability-customer-panel">
          <div className="network-serviceability-customer-header">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setServiceabilityCustomerId('');
                setServiceabilitySelectedNapId('');
                setServiceabilityNapDetailId('');
              }}
            >
              <IconChevronLeft size={16} className="me-2" />Customers
            </button>
          </div>
          <div className="network-serviceability-selected-customer">
            <small>Customer</small>
            <strong>{customerDisplayName(selectedCustomer)}</strong>
            <span>{selectedCustomer.accountNumber || selectedCustomer.contactNumber || '-'}</span>
          </div>
          <label className="network-serviceability-transfer-control">
            <span>Transfer / choose NAP</span>
            <select
              className="form-select"
              value={serviceabilitySelectedNapId}
              onChange={(event) => {
                setServiceabilitySelectedNapId(event.target.value);
                setServiceabilityNapDetailId('');
              }}
            >
              <option value="">Auto nearest available NAP</option>
              {napOptions.map((nap) => (
                <option key={nap.sourceId} value={nap.sourceId}>
                  {nap.label}{nap.serviceable ? '' : ' (no ports)'}
                </option>
              ))}
            </select>
          </label>
        </aside>
        <div className="network-serviceability-map-pane">
          {mapSurface}
        </div>
      </div>
    );
  }

  function renderMapPage() {
    const oltMarkerImage = mapImageFor('olt');
    const napMarkerImage = mapImageFor('nap');
    const focusFilteredMapLines = mapFocusedNodeId
      ? networkMap.lines.filter((line) => line.fromNodeId === mapFocusedNodeId || line.toNodeId === mapFocusedNodeId)
      : networkMap.lines;
    const renderMapLines = mapLineEditMode && mapSelectedLineId
      ? [
        ...focusFilteredMapLines.filter((line) => line.id !== mapSelectedLineId),
        ...focusFilteredMapLines.filter((line) => line.id === mapSelectedLineId)
      ]
      : focusFilteredMapLines;
    return (
      <div className="network-map-page">
        <div
          ref={mapSurfaceRef}
          className={`network-map-surface ${mapDragging ? 'dragging' : ''} ${mapEditMode ? 'edit-mode' : ''}`}
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
                <strong>Mapping</strong>
                <span>
                  {networkMap.totals.olts} OLTs / {networkMap.totals.naps} NAP boxes / {networkMap.totals.gps} GPS / {networkMap.mapMode}
                  {' / '}{networkMap.tileProvider?.label || 'Map'} z{networkMap.tileZoom}{mapHighDetail ? ' HD' : ''}{networkMap.nativeTileMaxed ? ' max' : ''}
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
              <label className={`network-map-edit-switch ${mapEditMode ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={mapEditMode}
                  onChange={(event) => setMapEditMode(event.target.checked)}
                />
                <span><IconMapPin size={15} /> Move markers</span>
              </label>
              <select
                className="form-select form-select-sm network-map-provider-select"
                value={activeMapProviderId}
                onChange={(event) => setMapTileMode(event.target.value)}
                title="Map provider"
                aria-label="Mapping map provider"
              >
                {mapProviderOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
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
          <svg className="network-map-links" viewBox={`0 0 ${networkMap.surface.width} ${networkMap.surface.height}`}>
            {renderMapLines.map((line) => {
              const fromDraft = mapMarkerDraft?.nodeId === line.fromNodeId ? mapMarkerDraft : null;
              const toDraft = mapMarkerDraft?.nodeId === line.toNodeId ? mapMarkerDraft : null;
              const points = mapLinePoints(line, fromDraft, toDraft);
              const path = mapLinkPath(points);
              const selected = line.id === mapSelectedLineId;
              const editLocked = Boolean(mapLineEditMode && mapSelectedLineId && !selected);
              const hiddenByMenu = Boolean(mapHideOtherLines && mapSelectedLineId && !selected);
              if (!path) return null;
              return (
                <g key={line.id} className={`network-map-link-group ${selected ? 'selected' : ''} ${mapLineEditMode && selected ? 'editing' : ''} ${editLocked ? 'edit-locked' : ''} ${hiddenByMenu ? 'hidden-by-menu' : ''}`}>
                  <path
                    className="network-map-link-hit"
                    d={path}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleMapLinePathClick(event, line, points)}
                  />
                  <path
                    className="network-map-link-path"
                    d={path}
                    stroke={mapLineEditMode && selected ? '#2563eb' : line.lineColor}
                    strokeDasharray={line.dash}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleMapLinePathClick(event, line, points)}
                  />
                  {selected && mapLineEditMode && (line.bendPoints || []).map((point) => (
                    <g
                      key={`${line.id}-${point.index}`}
                      className={`network-map-line-handle-wrap ${mapSavingLineId === line.id ? 'saving' : ''}`}
                    >
                      <circle
                        className="network-map-line-handle"
                        cx={point.x}
                        cy={point.y}
                        r="7"
                        onPointerDown={(event) => startMapLineBendDrag(event, line, point.index)}
                        onPointerMove={moveMapLineBendDrag}
                        onPointerUp={endMapLineBendDrag}
                        onPointerCancel={endMapLineBendDrag}
                      />
                      <g
                        className="network-map-line-handle-delete"
                        transform={`translate(${point.x} ${point.y - 21})`}
                        role="button"
                        aria-label="Remove bend point"
                        tabIndex="0"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                        }}
                        onClick={(event) => removeMapLineBendPoint(event, line, point.index)}
                      >
                        <circle r="8" />
                        <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
                      </g>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
          {selectedMapLine && mapLinePopover?.lineId === selectedMapLine.id && (
            <div
              className="network-map-line-popover"
              style={{ left: mapLinePopover.x, top: mapLinePopover.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              onPointerMove={moveMapLinePopoverDrag}
              onPointerUp={endMapLinePopoverDrag}
              onPointerCancel={endMapLinePopoverDrag}
            >
              <div className="network-map-line-popover-header" onPointerDown={startMapLinePopoverDrag}>
                <div>
                  <strong>{selectedMapLine.label}</strong>
                  <span>Drag this menu anywhere on the map</span>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm network-header-icon-button"
                  aria-label="Close line menu"
                  title="Close"
                  onClick={() => {
                    setMapLinePopover(null);
                    setMapLineEditMode(false);
                    setMapHideOtherLines(false);
                  }}
                >
                  <IconX size={15} />
                </button>
              </div>
              <div className="network-map-line-popover-actions">
                <label className="btn btn-outline-secondary btn-sm form-check form-switch network-map-line-edit-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    checked={mapLineEditMode}
                    onChange={(event) => setMapLineEditEnabled(selectedMapLine, event.target.checked)}
                  />
                  <span className="form-check-label">Edit Line</span>
                </label>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => {
                    openFiberLineModal(selectedMapLine);
                    setMapLinePopover(null);
                    setMapHideOtherLines(false);
                  }}
                >
                  <IconNetwork size={15} className="me-1" />Fiber
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={mapSavingLineId === selectedMapLine.id || !normalizeMapBendPoints(selectedMapLine.config?.mapBendPoints).length}
                  onClick={() => resetMapLineBends(selectedMapLine)}
                >
                  <IconRefresh size={15} className="me-1" />Reset
                </button>
                <label className="btn btn-outline-secondary btn-sm form-check form-switch network-map-line-edit-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    checked={mapHideOtherLines}
                    onChange={(event) => setMapHideOtherLines(event.target.checked)}
                  />
                  <span className="form-check-label">Hide Other Lines</span>
                </label>
              </div>
              <small>
                {mapSavingLineId === selectedMapLine.id ? 'Saving line...' : mapLineMessage || (mapLineEditMode ? 'Left-click the line to add a circle, then drag it.' : 'Viewing line details.')}
              </small>
            </div>
          )}
          <div className="network-map-marker-layer">
            {networkMap.nodes.map((node) => {
              const markerImage = node.type === 'olt' ? oltMarkerImage : napMarkerImage;
              const MarkerIcon = node.type === 'olt' ? IconWifi : IconBox;
              const draft = mapMarkerDraft?.nodeId === node.id ? mapMarkerDraft : null;
              const saving = mapSavingMarkerId === node.id;
              const markerStyle = {
                left: draft?.x ?? node.x,
                top: draft?.y ?? node.y,
                ...(node.type === 'nap' ? { '--network-map-marker-color': normalizeHexColor(node.ponColorHex, PON_COLOR_BASES[0]) } : {}),
                ...(node.type === 'olt' ? { '--network-map-marker-color': '#4f46e5' } : {})
              };
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`network-map-marker ${node.type} ${statusTone(node.status)} ${mapEditMode ? 'movable' : ''} ${draft ? 'moving' : ''} ${saving ? 'saving' : ''} ${mapFocusedNodeId === node.id ? 'focused' : ''}`}
                  style={markerStyle}
                  title={`${node.label} - ${node.detail}`}
                  onMouseDown={(event) => {
                    if (mapEditMode) startMapMarkerDrag(event, node);
                    else event.stopPropagation();
                  }}
                  onClick={(event) => focusMapNode(event, node)}
                >
                  <span className="network-map-marker-art">
                    {markerImage ? <img src={markerImage} alt="" /> : <MarkerIcon size={24} />}
                  </span>
                  {saving && <span className="network-map-marker-saving">Saving</span>}
                  {mapLayerVisibility.details && (
                    <span className="network-map-marker-label">
                      <strong>{node.label}</strong>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {mapEditMode && (
            <div className="network-map-edit-hint" onMouseDown={(event) => event.stopPropagation()}>
              {mapMarkerSaveError || (mapMarkerDraft ? `Drop to save ${mapMarkerDraft.latitude.toFixed(6)}, ${mapMarkerDraft.longitude.toFixed(6)}` : 'Drag an OLT or NAP marker to save its coordinates.')}
            </div>
          )}
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
                onClick={() => setMapLayerVisibility({ ...MAP_LAYER_VISIBILITY_DEFAULTS, links: true })}
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
              <span><i className="network-map-line-sample" /> Network topology links</span>
            </label>
            <label className="network-map-legend-check">
              <input type="checkbox" checked={mapLayerVisibility.details} onChange={() => toggleMapLayer('details')} />
              <span><i className="network-map-detail-sample" /> Names</span>
            </label>
            <small className="network-map-legend-source">{networkMap.tileAttribution}</small>
          </div>
        </div>
      </div>
    );
  }

  function fbtSplitPercentages(splitter, assignment = {}) {
    const ratio = String(assignment.ratio || splitter.splitRatio || '5:95').replace('/', ':');
    const [left = '5', right = '95'] = ratio.split(':');
    return { splitA: left, splitB: right };
  }

  function fbtSplitLabels(splitter, assignment = {}) {
    const percentages = fbtSplitPercentages(splitter, assignment);
    return {
      splitA: `${percentages.splitA}% to box`,
      splitB: `${percentages.splitB}% output`
    };
  }

  function fiberMappingSplitterDetails(assignment) {
    const splitter = assignment.splitter || {};
    const splitterType = normalizeSplitterType(splitter.splitterType);
    const isFbt = splitterType === 'FBT';
    const splitLabels = fbtSplitLabels(splitter, assignment);
    const assignmentLabel = assignment.ratio || splitter.splitRatio || (splitter.outputPorts ? `${splitter.outputPorts} ports` : splitter.model || splitter.manufacturer || 'Splitter');
    return [
      `${splitterType} ${assignmentLabel}`,
      isFbt ? `${splitLabels.splitA}; ${splitLabels.splitB}` : splitter.outputPorts ? `${splitter.outputPorts} outputs` : '',
      splitter.manufacturer || splitter.brand,
      splitter.model || splitter.name
    ].filter(Boolean).join(' / ');
  }

  function renderFiberSplitterLegend() {
    return (
      <div className="network-fiber-map-splitter-legend" onPointerDown={(event) => event.stopPropagation()}>
        <span><i className="split-a" /> Splitter A</span>
        <span><i className="split-b" /> Splitter B</span>
      </div>
    );
  }

  function renderFiberContainerEndpoint(containerKey, endpoint, point, options = {}) {
    const stickyOutput = options.modal && endpoint === 'output';
    return (
      <div
        className={`network-fiber-map-container-endpoint ${endpoint} ${stickyOutput ? 'sticky-output' : ''}`}
        style={stickyOutput ? { top: point.y } : { left: point.x, top: point.y }}
        data-fiber-container-endpoint={`${containerKey}|${endpoint}`}
        title={endpoint === 'input' ? 'IN: drag a splitter input here' : 'OUT: drag a splitter output here'}
        aria-label={endpoint === 'input' ? 'IN connector' : 'OUT connector'}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>{endpoint === 'input' ? 'IN' : 'OUT'}</span>
      </div>
    );
  }

  function renderFiberSplitterAddPopover(containerKey, metrics) {
    const draft = fiberSplitterAddDraft;
    if (!draft || draft.containerKey !== containerKey) return null;
    const typeOptions = fiberSplitterTypeOptions();
    const splitterOptions = splittersForPickerType(draft.splitterType);
    const selectedSplitter = fbts.find((splitter) => splitter.id === draft.splitterId) || splitterOptions[0] || null;
    const ratioChoices = fiberSplitterRatioChoices(selectedSplitter);
    const selectedType = normalizeSplitterType(selectedSplitter?.splitterType || draft.splitterType);
    const left = clamp((Number(draft.anchorX) || FIBER_INTERNAL_CANVAS.inputX) + 18, 8, Math.max(8, metrics.width - 286));
    const top = clamp((Number(draft.anchorY) || FIBER_INTERNAL_CANVAS.height / 2) - 18, 8, Math.max(8, metrics.height - 206));
    return (
      <div
        className="network-fiber-map-splitter-picker"
        style={{ left, top }}
        role="dialog"
        aria-label="Add splitter"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="network-fiber-map-splitter-picker-header">
          <strong>Add Splitter</strong>
          <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={closeFiberSplitterPicker}>
            <IconX size={14} />
          </button>
        </div>
        <label>
          <span>Type</span>
          <select className="form-select form-select-sm" value={draft.splitterType} onChange={(event) => updateFiberSplitterPickerType(event.target.value)}>
            {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          <span>Maker / Model</span>
          <select className="form-select form-select-sm" value={draft.splitterId} onChange={(event) => updateFiberSplitterPickerSplitter(event.target.value)}>
            {splitterOptions.map((splitter) => (
              <option key={splitter.id} value={splitter.id}>
                {[splitter.manufacturer || splitter.brand || 'Unknown maker', splitter.model || splitter.name || splitter.id].filter(Boolean).join(' / ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{selectedType === 'FBT' ? 'FBT Ratio' : 'Output Ratio'}</span>
          <select
            className="form-select form-select-sm"
            value={draft.ratio}
            onChange={(event) => setFiberSplitterAddDraft((current) => (current ? { ...current, ratio: event.target.value } : current))}
          >
            {ratioChoices.map((choice) => <option key={choice.value || 'default'} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
        {selectedSplitter && <div className="network-fiber-map-splitter-picker-hint">{fiberMappingSplitterDetails({ splitter: selectedSplitter, ratio: draft.ratio })}</div>}
        <div className="network-fiber-map-splitter-picker-actions">
          <button type="button" className="btn btn-sm" onClick={closeFiberSplitterPicker}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!draft.splitterId || fiberMappingSaving} onClick={submitFiberSplitterPicker}>
            Add
          </button>
        </div>
      </div>
    );
  }

  function renderConnectionDot(containerKey, assignmentId, terminal, terminalLabel, options = {}) {
    const {
      metrics = null,
      point: dotPoint = null,
      showAdd = terminal !== 'input',
      endpointAction = null,
      connectorLabel = ''
    } = options;
    const mapping = normalizeFiberMapping(fiberMapping);
    const pointKey = fiberMapConnectionPointKey(containerKey, assignmentId, terminal);
    const point = mapping.connectionPoints?.[pointKey];
    const pointLabel = connectionPointLabel(point);
    const pointValue = connectionPointValue(point).toLowerCase().replace('_', '-');
    const endpointRole = fiberMappingEndpointRole(point);
    const terminalSide = terminal === 'input' ? 'input' : 'output';
    return (
      <span className={`network-fiber-map-connection-wrap terminal-${terminalSide} ${endpointRole ? `endpoint-${endpointRole}` : ''} ${endpointAction ? 'has-role-action' : ''} ${showAdd ? 'has-add-action' : ''}`}>
        <button
          type="button"
          className={`network-fiber-map-connection-dot ${pointValue}`}
          title={`${terminalLabel}: ${pointLabel}`}
          aria-label={`${terminalLabel}: ${pointLabel}`}
          onPointerDown={(event) => {
            if (dotPoint && metrics) startFiberMappingInternalConnectionDrag(event, containerKey, assignmentId, terminal, dotPoint, metrics);
            else event.stopPropagation();
          }}
          onPointerMove={moveFiberMappingInternalConnectionDrag}
          onPointerUp={endFiberMappingInternalConnectionDrag}
          onPointerCancel={endFiberMappingInternalConnectionDrag}
          onClick={(event) => handleFiberMappingInternalConnectionClick(event, containerKey, assignmentId, terminal)}
        >
          <span />
        </button>
        {endpointRole && (
          <span className={`network-fiber-map-connection-endpoint-marker ${endpointRole}`}>
            {endpointRole === 'input' ? 'IN' : 'OUT'}
          </span>
        )}
        {(endpointAction || showAdd) && (
          <span className="network-fiber-map-connection-actions" onPointerDown={(event) => event.stopPropagation()}>
            {endpointAction && (
              <button
                type="button"
                className={`network-fiber-map-connection-role-action set-${endpointAction.role} ${endpointAction.active ? 'is-active' : ''}`}
                title={endpointAction.title}
                aria-label={endpointAction.title}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={endpointAction.onClick}
              >
                {endpointAction.label}
              </button>
            )}
            {showAdd && (
              <button
                type="button"
                className="network-fiber-map-connection-add"
                title="Add splitter from this connector"
                aria-label="Add splitter from this connector"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  addDefaultSplitterToFiberContainer(containerKey, assignmentId, terminal, dotPoint);
                }}
              >
                <IconPlus size={10} />
              </button>
            )}
          </span>
        )}
        {connectorLabel && <span className="network-fiber-map-connection-caption">{connectorLabel}</span>}
      </span>
    );
  }

  function renderFiberInternalPoint(containerKey, assignmentId, terminal, terminalLabel, point, key, metrics, endpointAction = null, connectorLabel = '') {
    const endpointRole = fiberMappingEndpointRole(fiberMappingConnectionPointForTerminal(containerKey, assignmentId, terminal));
    return (
      <div
        key={key}
        className={`network-fiber-map-internal-point ${endpointRole ? `endpoint-${endpointRole}` : ''}`}
        style={{ left: point.x, top: point.y }}
      >
        {renderConnectionDot(containerKey, assignmentId, terminal, terminalLabel, {
          metrics,
          point,
          showAdd: terminal !== 'input',
          endpointAction,
          connectorLabel
        })}
      </div>
    );
  }

  function renderFiberInternalMiniCanvas(containerKey, assignments = [], options = {}) {
    const { modal = false, incomingEdge = null } = options;
    const metrics = fiberInternalCanvasMetrics(assignments, containerKey, { modal });
    const childByParentTerminal = new Map();
    assignments.forEach((assignment, index) => {
      if (!assignment.parentAssignmentId || !assignment.parentTerminal) return;
      childByParentTerminal.set(`${assignment.parentAssignmentId}|${assignment.parentTerminal}`, { assignment, index });
    });
    const inputPoints = new Map();
    const naturalPoints = new Map();
    assignments.forEach((assignment, index) => {
      const position = metrics.positions[index];
      const inputFallback = fiberInternalInputFallback(position, index, metrics, assignment);
      naturalPoints.set(`${assignment.assignmentId}|input`, inputFallback);
      inputPoints.set(assignment.assignmentId, fiberInternalConnectionPointPosition(
        containerKey,
        assignment.assignmentId,
        'input',
        inputFallback
      ));
    });
    const incomingFeederPoint = incomingEdge
      ? assignments[0]
        ? inputPoints.get(assignments[0].assignmentId)
        : { x: FIBER_INTERNAL_CANVAS.inputX + 54, y: metrics.height / 2 }
      : null;
    const incomingFeederProfile = incomingEdge ? fiberOptics.find((profile) => profile.id === incomingEdge.config?.fiberOpticLossId) : null;
    const incomingFeederColor = incomingEdge ? fiberLineColorForConfig(incomingEdge.config, incomingFeederProfile) : '#2563EB';
    const terminalChildPosition = (assignment, index, terminal) => {
      const explicitChild = childByParentTerminal.get(`${assignment.assignmentId}|${terminal}`);
      if (explicitChild) return inputPoints.get(explicitChild.assignment.assignmentId);
      const legacyNext = assignments[index + 1];
      if (legacyNext && !legacyNext.parentAssignmentId && terminal === fiberLegacyChildTerminalForAssignment(assignment)) {
        return inputPoints.get(legacyNext.assignmentId);
      }
      return null;
    };
    const endpointActionFor = (assignment, endpoint, terminal, point, naturalPoint) => {
      const role = endpoint === 'input' ? 'input' : 'output';
      const roleLabel = role === 'input' ? 'IN' : 'OUT';
      const roleActive = fiberMappingEndpointRole(fiberMappingConnectionPointForTerminal(containerKey, assignment.assignmentId, terminal)) === role;
      return {
        role,
        label: roleLabel,
        active: roleActive,
        title: roleActive ? `${roleLabel} x` : roleLabel,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFiberMappingSplitterEndpointRole(
            containerKey,
            assignment.assignmentId,
            role,
            terminal,
            point,
            naturalPoint,
            metrics
          );
        }
      };
    };
    const paths = [];
    const points = [];
    const terminalCaptions = [];
    const ratioCaptionPoint = (start, end) => {
      const dx = Number(end?.x || 0) - Number(start?.x || 0);
      const dy = Number(end?.y || 0) - Number(start?.y || 0);
      const length = Math.hypot(dx, dy);
      if (!length) return end;
      const offset = Math.min(FIBER_FBT_RATIO_LABEL_END_OFFSET, length / 2);
      return {
        x: end.x - (dx / length) * offset,
        y: end.y - (dy / length) * offset
      };
    };
    assignments.forEach((assignment, index) => {
      const position = metrics.positions[index];
      const isFirstSplitter = index === 0;
      const isLastSplitter = index === assignments.length - 1;
      const outputTerminal = fiberMappingOutTerminalForAssignment(assignment);
      const inputPoint = inputPoints.get(assignment.assignmentId);
      const splitterType = normalizeSplitterType(assignment.splitter?.splitterType);
      const isFbt = splitterType === 'FBT';
      const fbtSplit = isFbt ? fbtSplitPercentages(assignment.splitter || {}, assignment) : null;
      paths.push({
        id: `${assignment.assignmentId}-input`,
        d: fiberInternalCurvePath(inputPoint, position),
        assignmentId: assignment.assignmentId,
        terminal: 'input',
        point: inputPoint,
        tone: assignment.parentTerminal === 'splitA' ? 'split-a' : assignment.parentTerminal === 'splitB' ? 'split-b' : 'input'
      });
      points.push({
        key: `${assignment.assignmentId}-input`,
        assignmentId: assignment.assignmentId,
        terminal: 'input',
        label: index === 0 && !assignment.parentAssignmentId ? 'Input connection' : 'Splitter input connection',
        point: inputPoint,
        endpointAction: isFirstSplitter ? endpointActionFor(assignment, 'input', 'input', inputPoint, naturalPoints.get(`${assignment.assignmentId}|input`)) : null
      });
      if (isFbt) {
        const splitAFallback = {
          x: Math.min(position.x + FIBER_INTERNAL_CANVAS.branchLength, metrics.width - 32),
          y: clamp(position.y + FIBER_INTERNAL_CANVAS.outputGap, 32, metrics.height - 28)
        };
        const splitBFallback = {
          x: Math.min(position.x + FIBER_INTERNAL_CANVAS.branchLength, metrics.width - 32),
          y: clamp(position.y - FIBER_INTERNAL_CANVAS.outputGap, 32, metrics.height - 28)
        };
        const splitAChildPosition = terminalChildPosition(assignment, index, 'splitA');
        const splitBChildPosition = terminalChildPosition(assignment, index, 'splitB');
        const splitAChild = childByParentTerminal.get(`${assignment.assignmentId}|splitA`);
        const splitBChild = childByParentTerminal.get(`${assignment.assignmentId}|splitB`);
        const splitA = splitAChildPosition || fiberInternalConnectionPointPosition(containerKey, assignment.assignmentId, 'splitA', splitAFallback);
        const splitB = splitBChildPosition || fiberInternalConnectionPointPosition(containerKey, assignment.assignmentId, 'splitB', splitBFallback);
        if (fbtSplit) {
          terminalCaptions.push(
            {
              key: `${assignment.assignmentId}-split-a-ratio`,
              label: `${fbtSplit.splitA}%`,
              point: ratioCaptionPoint(position, splitA)
            },
            {
              key: `${assignment.assignmentId}-split-b-ratio`,
              label: `${fbtSplit.splitB}%`,
              point: ratioCaptionPoint(position, splitB)
            }
          );
        }
        paths.push({
          id: `${assignment.assignmentId}-split-a`,
          d: fiberInternalCurvePath(position, splitA),
          assignmentId: splitAChildPosition ? '' : assignment.assignmentId,
          terminal: splitAChildPosition ? '' : 'splitA',
          point: splitAChildPosition ? null : splitA,
          spawnedKey: splitAChild ? fiberMapSplitterSelectionKey(containerKey, splitAChild.assignment.assignmentId) : '',
          tone: 'split-a'
        });
        paths.push({
          id: `${assignment.assignmentId}-split-b`,
          d: fiberInternalCurvePath(position, splitB),
          assignmentId: splitBChildPosition ? '' : assignment.assignmentId,
          terminal: splitBChildPosition ? '' : 'splitB',
          point: splitBChildPosition ? null : splitB,
          spawnedKey: splitBChild ? fiberMapSplitterSelectionKey(containerKey, splitBChild.assignment.assignmentId) : '',
          tone: 'split-b'
        });
        if (!splitAChildPosition) {
          points.push({
            key: `${assignment.assignmentId}-split-a`,
            assignmentId: assignment.assignmentId,
            terminal: 'splitA',
            label: 'Split A connection',
            point: splitA,
            endpointAction: isLastSplitter && outputTerminal === 'splitA' ? endpointActionFor(assignment, 'output', 'splitA', splitA, splitAFallback) : null
          });
        }
        if (!splitBChildPosition) {
          points.push({
            key: `${assignment.assignmentId}-split-b`,
            assignmentId: assignment.assignmentId,
            terminal: 'splitB',
            label: 'Split B connection',
            point: splitB,
            endpointAction: isLastSplitter && outputTerminal === 'splitB' ? endpointActionFor(assignment, 'output', 'splitB', splitB, splitBFallback) : null
          });
        }
      } else {
        const outputFallback = {
          x: Math.min(position.x + FIBER_INTERNAL_CANVAS.branchLength, metrics.width - 32),
          y: position.y
        };
        const outputChildPosition = terminalChildPosition(assignment, index, 'output');
        const outputChild = childByParentTerminal.get(`${assignment.assignmentId}|output`);
        const output = outputChildPosition || fiberInternalConnectionPointPosition(containerKey, assignment.assignmentId, 'output', outputFallback);
        paths.push({
          id: `${assignment.assignmentId}-output`,
          d: fiberInternalCurvePath(position, output),
          assignmentId: outputChildPosition ? '' : assignment.assignmentId,
          terminal: outputChildPosition ? '' : 'output',
          point: outputChildPosition ? null : output,
          spawnedKey: outputChild ? fiberMapSplitterSelectionKey(containerKey, outputChild.assignment.assignmentId) : '',
          tone: 'output'
        });
        if (!outputChildPosition) {
          points.push({
            key: `${assignment.assignmentId}-output`,
            assignmentId: assignment.assignmentId,
            terminal: 'output',
            label: 'Output connection',
            point: output,
            endpointAction: isLastSplitter && outputTerminal === 'output' ? endpointActionFor(assignment, 'output', 'output', output, outputFallback) : null
          });
        }
      }
    });
    return (
      <div
        className={`network-fiber-map-internal-canvas ${modal ? 'modal-layout' : ''}`}
        style={{ width: metrics.width, height: metrics.height }}
        onPointerDown={(event) => {
          if (!modal) event.stopPropagation();
        }}
      >
        <svg
          className="network-fiber-map-internal-canvas-svg"
          viewBox={`0 0 ${metrics.width} ${metrics.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {paths.filter((path) => path.assignmentId && path.terminal && path.point).map((path) => (
            <path
              key={`${path.id}-hit`}
              className="network-fiber-map-internal-canvas-hit"
              d={path.d}
              onPointerDown={(event) => startFiberMappingInternalConnectionDrag(
                event,
                containerKey,
                path.assignmentId,
                path.terminal,
                path.point,
                metrics
              )}
              onPointerMove={moveFiberMappingInternalConnectionDrag}
              onPointerUp={endFiberMappingInternalConnectionDrag}
              onPointerCancel={endFiberMappingInternalConnectionDrag}
            />
          ))}
          {incomingFeederPoint && (
            <g className="network-fiber-map-internal-feeder">
              <path
                className="network-fiber-map-internal-feeder-line"
                d={`M 8 ${incomingFeederPoint.y} C ${Math.max(34, incomingFeederPoint.x * 0.42)} ${incomingFeederPoint.y}, ${Math.max(48, incomingFeederPoint.x - 34)} ${incomingFeederPoint.y}, ${incomingFeederPoint.x} ${incomingFeederPoint.y}`}
                style={{ stroke: incomingFeederColor }}
              />
              <circle
                className="network-fiber-map-internal-feeder-dot"
                cx={incomingFeederPoint.x}
                cy={incomingFeederPoint.y}
                r="5"
                style={{ stroke: incomingFeederColor }}
              />
            </g>
          )}
          {paths.map((path) => (
            <path
              key={path.id}
              className={`network-fiber-map-internal-canvas-link ${path.tone ? `tone-${path.tone}` : ''} ${path.spawnedKey && path.spawnedKey === fiberMappingSpawnedSplitterKey ? 'growing' : ''}`}
              d={path.d}
            />
          ))}
        </svg>
        {renderFiberSplitterLegend()}
        {!assignments.length && (
          <div className={`network-fiber-map-internal-empty ${modal ? 'modal-layout' : ''}`}>
            <button
              type="button"
              className="network-fiber-map-internal-empty-add"
              title="Add splitter"
              aria-label="Add splitter"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                addDefaultSplitterToFiberContainer(containerKey, '', '', { x: FIBER_INTERNAL_CANVAS.inputX + 54, y: metrics.height / 2 });
              }}
            >
              <IconPlus size={16} />
            </button>
          </div>
        )}
        {incomingFeederPoint && (
          <span
            className="network-fiber-map-internal-feeder-label"
            style={{ left: 12, top: Math.max(8, incomingFeederPoint.y - 30) }}
          >
            Incoming fiber
          </span>
        )}
        {points.map((item) => renderFiberInternalPoint(containerKey, item.assignmentId, item.terminal, item.label, item.point, item.key, metrics, item.endpointAction || null, item.connectorLabel || ''))}
        {terminalCaptions.map((item) => (
          <span
            key={item.key}
            className="network-fiber-map-terminal-ratio"
            style={{ left: item.point.x, top: item.point.y }}
          >
            {item.label}
          </span>
        ))}
        {assignments.map((assignment, index) => {
          const position = metrics.positions[index];
          const selected = fiberMappingSelectedSplitterKey === fiberMapSplitterSelectionKey(containerKey, assignment.assignmentId);
          const splitterDetails = fiberMappingSplitterDetails(assignment);
          const splitterType = normalizeSplitterType(assignment.splitter?.splitterType);
          const isFbt = splitterType === 'FBT';
          const splitterRatioLabel = isFbt ? formatFbtRatio(assignment.ratio || assignment.splitter?.splitRatio || '5:95') : '';
          const plcDisplay = plcSplitterDisplayFor(assignment);
          return (
            <div
              className={`network-fiber-map-internal-splitter-wrap ${plcDisplay ? `has-svg-equipment plc-equipment outputs-${plcDisplay.outputPorts}` : ''} ${selected ? 'selected' : ''} ${fiberMappingSpawnedSplitterKey === fiberMapSplitterSelectionKey(containerKey, assignment.assignmentId) ? 'spawning' : ''}`}
              key={assignment.assignmentId}
              style={{ left: position.x, top: position.y }}
            >
              <button
                type="button"
                className={`network-fiber-map-internal-splitter ${plcDisplay ? 'with-svg-equipment' : ''}`}
                title={`${splitterDetails}. Click to select. Press Delete or Backspace to remove.`}
                aria-label={`${splitterDetails}. Click to select. Press Delete or Backspace to remove.`}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key !== 'Delete' && event.key !== 'Del' && event.key !== 'Backspace') return;
                  event.preventDefault();
                  event.stopPropagation();
                  removeSplitterFromFiberContainer(containerKey, assignment.assignmentId);
                }}
                onClick={(event) => handleFiberMappingInternalSplitterClick(event, containerKey, assignment.assignmentId)}
              >
                {plcDisplay && renderPlcSplitterSvg(plcDisplay)}
              </button>
              {splitterRatioLabel && <span className="network-fiber-map-internal-splitter-ratio">{splitterRatioLabel}</span>}
              <button
                type="button"
                className="network-fiber-map-internal-splitter-remove"
                title="Remove splitter"
                aria-label="Remove splitter"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeSplitterFromFiberContainer(containerKey, assignment.assignmentId);
                }}
              >
                -
              </button>
            </div>
          );
        })}
        {renderFiberSplitterAddPopover(containerKey, metrics)}
      </div>
    );
  }

  function renderFiberContainerBody(node, assignedSplitters, expanded) {
    const containerName = node.type === 'junction' ? 'Junction Box' : 'NAP';
    const splitterSummary = fiberSplitterSummaryText(assignedSplitters);
    if (!expanded && !splitterSummary) return null;
    return (
      <div className={`network-fiber-map-container-body ${expanded ? 'expanded' : 'collapsed'}`} onPointerDown={(event) => event.stopPropagation()}>
        <div className={`network-fiber-map-container-toolbar ${splitterSummary ? 'has-summary' : ''}`}>
          {splitterSummary && (
            <span className="network-fiber-map-container-summary" title={splitterSummary}>
              {splitterSummary}
            </span>
          )}
          {expanded && (
            <span className="network-fiber-map-container-actions">
              <button
                type="button"
                className="badge network-action-badge bg-azure-lt text-azure border-0"
                title={`Open ${containerName} canvas`}
                aria-label={`Open ${containerName} canvas`}
                onClick={() => openFiberMappingLayoutModal(node)}
              >
                <IconArrowsMaximize size={18} />
              </button>
              <button
                type="button"
                className="badge network-action-badge bg-red-lt text-red border-0"
                title={`Close ${containerName}`}
                aria-label={`Close ${containerName}`}
                aria-expanded={expanded}
                onClick={() => collapseFiberMappingContainer(node.key)}
              >
                <IconX size={18} />
              </button>
            </span>
          )}
        </div>
        <div className="network-fiber-map-internal-lines">
          {renderFiberInternalMiniCanvas(node.key, assignedSplitters)}
        </div>
      </div>
    );
  }

  function renderFiberMappingTreeViewPage({ oltMarkerImage, napMarkerImage, mappedNapKeys }) {
    const activeOlt = olts.find((olt) => olt.id === selectedOltId) || olts[0] || null;
    const activeOltKey = activeOlt ? fiberMapNodeKey('olt', activeOlt.id) : '';
    const nodeByKey = new Map(fiberMappingCanvas.nodes.map((node) => [node.key, node]));
    const childrenByKey = new Map();
    const parentByKey = new Map();
    const edgeByChildKey = new Map();
    const treeRowsByRootKey = new Map();
    const searchTerm = String(search || '').trim().toLowerCase();
    const nodeTypeOrder = {
      olt: 0,
      pon: 1,
      nap: 2,
      junction: 3
    };

    fiberMappingCanvas.edges.forEach((edge) => {
      const fromKey = nodeByKey.has(edge.fromKey)
        ? edge.fromKey
        : nodeByKey.has(edge.fallbackFromKey)
          ? edge.fallbackFromKey
          : '';
      if (!fromKey || !nodeByKey.has(edge.toKey)) return;
      const currentChildren = childrenByKey.get(fromKey) || [];
      if (!currentChildren.includes(edge.toKey)) currentChildren.push(edge.toKey);
      childrenByKey.set(fromKey, currentChildren);
      parentByKey.set(edge.toKey, fromKey);
      edgeByChildKey.set(edge.toKey, edge);
    });

    const sortTreeNodeKeys = (leftKey, rightKey) => {
      const left = nodeByKey.get(leftKey) || {};
      const right = nodeByKey.get(rightKey) || {};
      const typeDifference = (nodeTypeOrder[left.type] ?? 9) - (nodeTypeOrder[right.type] ?? 9);
      if (typeDifference) return typeDifference;
      if (left.type === 'pon' && right.type === 'pon') {
        const portDifference = Number(left.source?.portNumber || 0) - Number(right.source?.portNumber || 0);
        if (portDifference) return portDifference;
      }
      return String(left.label || '').localeCompare(String(right.label || ''));
    };

    const appendTreeRows = (nodeKey, depth = 0, rows = [], seen = new Set()) => {
      const node = nodeByKey.get(nodeKey);
      if (!node || seen.has(nodeKey)) return rows;
      const nextSeen = new Set([...seen, nodeKey]);
      rows.push({ node, depth, edge: edgeByChildKey.get(nodeKey) || null });
      [...(childrenByKey.get(nodeKey) || [])]
        .sort(sortTreeNodeKeys)
        .forEach((childKey) => appendTreeRows(childKey, depth + 1, rows, nextSeen));
      return rows;
    };

    const treeRowsForRoot = (rootKey) => {
      if (!rootKey) return [];
      if (!treeRowsByRootKey.has(rootKey)) treeRowsByRootKey.set(rootKey, appendTreeRows(rootKey));
      return treeRowsByRootKey.get(rootKey);
    };

    const nodeMatchesSearch = (node) => {
      if (!searchTerm) return true;
      const source = node.source || {};
      return [
        node.label,
        node.detail,
        node.type,
        source.name,
        source.label,
        source.vendor,
        source.model,
        source.managementIp,
        source.barangay,
        source.status
      ].filter(Boolean).join(' ').toLowerCase().includes(searchTerm);
    };

    const directMatchKeys = new Set(
      searchTerm
        ? fiberMappingCanvas.nodes.filter(nodeMatchesSearch).map((node) => node.key)
        : []
    );
    const hasMatchingAncestor = (nodeKey) => {
      let cursor = parentByKey.get(nodeKey);
      const seen = new Set();
      while (cursor && !seen.has(cursor)) {
        if (directMatchKeys.has(cursor)) return true;
        seen.add(cursor);
        cursor = parentByKey.get(cursor);
      }
      return false;
    };
    const hasMatchingDescendant = (nodeKey, seen = new Set()) => {
      if (seen.has(nodeKey)) return false;
      const nextSeen = new Set([...seen, nodeKey]);
      return (childrenByKey.get(nodeKey) || []).some((childKey) => (
        directMatchKeys.has(childKey) || hasMatchingDescendant(childKey, nextSeen)
      ));
    };
    const shouldShowRow = ({ node }) => (
      !searchTerm
      || directMatchKeys.has(node.key)
      || hasMatchingAncestor(node.key)
      || hasMatchingDescendant(node.key)
    );

    const activeRows = activeOltKey ? treeRowsForRoot(activeOltKey) : [];
    const visibleRows = activeRows.filter(shouldShowRow);
    const fiberTreeRowHeight = 56;
    const fiberTreeDepthOffset = 56;
    const fiberTreeIconCenterX = (depth) => 52 + depth * fiberTreeDepthOffset;
    const visibleRowsWithIndex = visibleRows.map((row, index) => ({ ...row, index }));
    const visibleRowIndexByKey = new Map(visibleRowsWithIndex.map((row) => [row.node.key, row.index]));
    const treeConnectorHeight = Math.max(fiberTreeRowHeight, visibleRowsWithIndex.length * fiberTreeRowHeight);
    const treeConnectorWidth = Math.max(
      360,
      (visibleRowsWithIndex.reduce((maximum, row) => Math.max(maximum, row.depth), 0) + 1) * fiberTreeDepthOffset + 180
    );
    const treeConnectors = visibleRowsWithIndex.map((row) => {
      const parentKey = parentByKey.get(row.node.key);
      const parentIndex = visibleRowIndexByKey.get(parentKey);
      if (parentIndex === undefined || !row.edge) return null;
      const parentRow = visibleRowsWithIndex[parentIndex];
      if (!parentRow) return null;
      const startX = fiberTreeIconCenterX(parentRow.depth) + 18;
      const endX = fiberTreeIconCenterX(row.depth) - 12;
      const startY = parentRow.index * fiberTreeRowHeight + fiberTreeRowHeight / 2;
      const endY = row.index * fiberTreeRowHeight + fiberTreeRowHeight / 2;
      const controlOffset = clamp(Math.abs(endX - startX) * 0.72, 24, 72);
      const lineStyle = String(row.edge.config?.lineStyle || '').toUpperCase();
      const edgeProfile = fiberOptics.find((profile) => profile.id === row.edge.config?.fiberOpticLossId);
      return {
        id: row.edge.id,
        d: `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`,
        color: row.edge.type === 'olt-pon' ? '#16a34a' : fiberLineColorForConfig(row.edge.config, edgeProfile),
        dash: lineStyle === 'DASHED' ? '10 7' : lineStyle === 'DOTTED' ? '2 7' : '',
        selected: row.edge.id === fiberMappingSelectedEdgeId,
        directNapToNap: row.edge.fromKey?.startsWith('nap:') && row.edge.toKey?.startsWith('nap:')
      };
    }).filter(Boolean);
    const activePonCount = activeRows.filter((row) => row.node.type === 'pon').length;
    const activeNapCount = activeRows.filter((row) => row.node.type === 'nap').length;
    const activeJunctionCount = activeRows.filter((row) => row.node.type === 'junction').length;
    const activeLinkCount = activeRows.filter((row) => row.edge).length;

    const placeFiberTreeMenu = (anchorElement) => {
      const rect = anchorElement?.getBoundingClientRect?.();
      if (!rect) return null;
      const margin = 12;
      const gap = 8;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
      const width = Math.min(224, Math.max(176, viewportWidth - margin * 2));
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin - gap);
      const spaceAbove = Math.max(0, rect.top - margin - gap);
      const opensAbove = spaceBelow < 190 && spaceAbove > spaceBelow;
      const availableHeight = opensAbove ? spaceAbove : spaceBelow;
      const left = clamp(rect.right - width, margin, Math.max(margin, viewportWidth - width - margin));
      const maxHeight = clamp(availableHeight || 190, 160, Math.max(160, viewportHeight - margin * 2));
      return {
        left: `${Math.round(left)}px`,
        top: opensAbove ? 'auto' : `${Math.round(Math.min(rect.bottom + gap, viewportHeight - margin - maxHeight))}px`,
        bottom: opensAbove ? `${Math.round(Math.max(margin, viewportHeight - rect.top + gap))}px` : 'auto',
        width: `${Math.round(width)}px`,
        maxHeight: `${Math.round(maxHeight)}px`
      };
    };

    const toggleFiberTreeAddMenu = (event, nodeKey) => {
      const shouldOpen = fiberMappingNapMenuPonId !== nodeKey;
      setFiberMappingNapMenuPonId(shouldOpen ? nodeKey : '');
      setFiberMappingTreeMenuPlacement(shouldOpen ? placeFiberTreeMenu(event.currentTarget) : null);
    };

    const renderAddMenu = (node, menuPonId, availableNaps) => (
      <div
        className="network-fiber-map-nap-menu network-fiber-tree-menu"
        style={fiberMappingTreeMenuPlacement || undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {menuPonId && (
          <>
            {availableNaps.map((nap) => (
              <button
                type="button"
                key={nap.id}
                className="network-fiber-tree-menu-command"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  addNapToFiberMapping(menuPonId, nap.id, node);
                }}
              >
                <span className="network-fiber-tree-menu-icon nap" aria-hidden="true">
                  {napMarkerImage ? <img src={napMarkerImage} alt="" /> : <IconBox size={16} />}
                </span>
                <span className="network-fiber-tree-menu-copy">
                  <span>{nap.name}</span>
                  <small>{nap.barangay || nap.status}</small>
                </span>
              </button>
            ))}
            {!availableNaps.length && <span className="badge bg-secondary-lt text-secondary network-fiber-tree-menu-tag">No remaining NAP boxes for this PON</span>}
          </>
        )}
        <button
          type="button"
          className="network-fiber-tree-menu-command"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            addJunctionBoxToFiberMapping(node);
          }}
        >
          <span className="network-fiber-tree-menu-icon junction" aria-hidden="true"><IconBox size={16} /></span>
          <span className="network-fiber-tree-menu-copy">
            <span>Add Junction Box</span>
          </span>
        </button>
      </div>
    );

    const downstreamEdgesForKey = (rootKey) => {
      const collected = [];
      const queue = [...(childrenByKey.get(rootKey) || [])];
      const seen = new Set();
      while (queue.length) {
        const childKey = queue.shift();
        if (seen.has(childKey)) continue;
        seen.add(childKey);
        const childEdge = edgeByChildKey.get(childKey);
        if (childEdge && childEdge.type !== 'olt-pon') collected.push(childEdge);
        queue.push(...(childrenByKey.get(childKey) || []));
      }
      return collected;
    };

    const renderTreeRow = ({ node, depth, edge }) => {
      const NodeIcon = node.type === 'olt' ? IconWifi : node.type === 'pon' ? IconPlugConnected : IconBox;
      const markerImage = node.type === 'olt' ? oltMarkerImage : node.type === 'nap' ? napMarkerImage : '';
      const nodeTypeLabel = node.type === 'olt' ? 'OLT' : node.type === 'pon' ? 'PON' : node.type === 'junction' ? 'Junction' : 'NAP';
      const selected = fiberMappingSelectedNodeKeys.includes(node.key);
      const isFiberContainer = node.type === 'nap' || node.type === 'junction';
      const canAddDownstream = ['pon', 'nap', 'junction'].includes(node.type);
      const menuPonId = node.type === 'pon' ? node.source.id : node.ponId || '';
      const availableNaps = menuPonId
        ? naps.filter((nap) => nap.ponPortId === menuPonId && !mappedNapKeys.has(fiberMapNodeKey('nap', nap.id)))
        : [];
      const assignedSplitters = isFiberContainer
        ? (node.splitterAssignments || []).map((assignment) => {
          const splitter = splittersById.get(assignment.splitterId);
          return splitter ? { ...assignment, splitter } : null;
        }).filter(Boolean)
        : [];
      const splitterSummary = isFiberContainer ? fiberSplitterSummaryText(assignedSplitters) : '';
      const ponFiberEdges = node.type === 'pon' ? downstreamEdgesForKey(node.key) : [];
      const ponFiberAssigned = ponFiberEdges.some((fiberEdge) => fiberEdge.config?.fiberOpticLossId);
      const receivePower = edge?.budget?.receivePowerDbm;
      const budgetLabel = edge?.napId && receivePower !== null && receivePower !== undefined
        ? `${Number(receivePower).toFixed(2)} dBm`
        : edge?.config?.fiberOpticLossId
          ? edge.budget?.wavelength || 'Fiber assigned'
          : '';
      const removeNode = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFiberMappingDeleteModalForKeys([node.key]);
      };
      const selectRow = () => {
        setFiberMappingSelectedNodeKeys([node.key]);
        setFiberMappingSelectedEdgeId('');
        setFiberMappingSelectedSplitterKey('');
        fiberMappingSelectedSplitterKeyRef.current = '';
      };

      return (
        <div
          key={node.key}
          className={`network-fiber-tree-row ${node.type} ${selected ? 'selected' : ''}`}
          role="treeitem"
          aria-level={depth + 1}
          style={{ '--tree-depth-offset': `${depth * fiberTreeDepthOffset}px` }}
          onClick={selectRow}
        >
          {depth > 0 && <span className="network-fiber-tree-branch" aria-hidden="true" />}
          <span className="network-fiber-tree-expander" aria-hidden="true" />
          <span className={`network-fiber-tree-icon ${node.type}`} aria-hidden="true">
            {markerImage ? <img src={markerImage} alt="" /> : <NodeIcon size={18} />}
          </span>
          <span className="network-fiber-tree-main">
            <span className="network-fiber-tree-title">
              <strong>{node.label}</strong>
              <span className={`badge network-fiber-map-node-type ${node.type}`}>{nodeTypeLabel}</span>
            </span>
            <span className="network-fiber-tree-detail">
              {node.detail || nodeTypeLabel}
              {node.type === 'pon' && (
                <>
                  {' / '}
                  {formatDbm(node.source.moduleRxPowerDbm)}
                  {' / '}
                  {node.napCount || 0} NAPs
                </>
              )}
              {splitterSummary && <em>{splitterSummary}</em>}
            </span>
          </span>
          {budgetLabel && <span className="network-fiber-tree-budget">{budgetLabel}</span>}
          <span className="network-fiber-tree-actions" onPointerDown={(event) => event.stopPropagation()}>
            {node.type === 'pon' && (
              <button
                type="button"
                className={`badge network-action-badge ${ponFiberAssigned ? 'bg-green-lt text-green' : 'bg-cyan-lt text-cyan'} border-0`}
                title="Assign PON fiber links"
                aria-label="Assign PON fiber links"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openPonFiberLinkCanvas(node.source?.id);
                }}
              >
                <IconAntenna size={17} />
              </button>
            )}
            {canAddDownstream && (
              <button
                type="button"
                className="badge network-action-badge bg-green-lt text-green border-0"
                title={node.type === 'pon' ? 'Add from this PON' : `Add after this ${nodeTypeLabel}`}
                aria-label={node.type === 'pon' ? 'Add from this PON' : `Add after this ${nodeTypeLabel}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleFiberTreeAddMenu(event, node.key);
                }}
              >
                <IconPlus size={17} />
              </button>
            )}
            {isFiberContainer && (
              <>
                <button
                  type="button"
                  className="badge network-action-badge bg-azure-lt text-azure border-0"
                  title={`Open ${nodeTypeLabel} splitters`}
                  aria-label={`Open ${nodeTypeLabel} splitters`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFiberMappingLayoutModal(node);
                  }}
                >
                  <IconArrowsMaximize size={17} />
                </button>
                <button
                  type="button"
                  className="badge network-action-badge bg-red-lt text-red border-0"
                  title={`Remove ${nodeTypeLabel} branch`}
                  aria-label={`Remove ${nodeTypeLabel} branch`}
                  onClick={removeNode}
                >
                  <IconTrash size={17} />
                </button>
              </>
            )}
          </span>
        </div>
      );
    };

    const floatingMenuNode = visibleRowsWithIndex.find(({ node }) => node.key === fiberMappingNapMenuPonId)?.node || null;
    const floatingMenuPonId = floatingMenuNode
      ? floatingMenuNode.type === 'pon'
        ? floatingMenuNode.source?.id || ''
        : floatingMenuNode.ponId || ''
      : '';
    const floatingMenuAvailableNaps = floatingMenuPonId
      ? naps.filter((nap) => nap.ponPortId === floatingMenuPonId && !mappedNapKeys.has(fiberMapNodeKey('nap', nap.id)))
      : [];

    return (
      <div className="network-fiber-map-page treeview-mode">
        <div className="network-fiber-map-toolbar">
          <div className="network-fiber-map-toolbar-title">
            <span className="badge bg-teal-lt text-teal"><IconNetwork size={18} /></span>
            <div>
              <strong>Network Topology</strong>
              <span>
                {fiberMappingCanvas.totals.olts} OLTs / {fiberMappingCanvas.totals.pons} PONs / {fiberMappingCanvas.totals.naps} NAPs / {fiberMappingCanvas.totals.junctions} junctions
              </span>
            </div>
          </div>
          <div className="network-fiber-map-toolbar-actions">
            <SearchInput value={search} onChange={setSearch} placeholder="Search OLT, PON, NAP, junction" />
          </div>
        </div>

        <div className="network-fiber-tree-shell">
          <div className="network-fiber-tree-tabs nav nav-tabs" role="tablist">
            {olts.map((olt) => {
              const oltKey = fiberMapNodeKey('olt', olt.id);
              const rows = treeRowsForRoot(oltKey);
              const mappedCount = rows.filter((row) => row.node.type === 'nap').length;
              const ponCount = rows.filter((row) => row.node.type === 'pon').length;
              const active = activeOlt?.id === olt.id;
              return (
                <button
                  type="button"
                  key={olt.id}
                  className={`nav-link network-fiber-tree-tab ${active ? 'active' : ''}`}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedOltId(olt.id);
                    setFiberMappingNapMenuPonId('');
                    setFiberMappingSelectedNodeKeys([oltKey]);
                    setFiberMappingSelectedEdgeId('');
                  }}
                >
                  <span>{olt.name}</span>
                  <small>{ponCount} PON / {mappedCount} NAP</small>
                </button>
              );
            })}
          </div>

          <div className="network-fiber-tree-panel">
            {activeOlt ? (
              <>
                <div className="network-fiber-tree-summary">
                  <span className="network-fiber-tree-icon olt" aria-hidden="true">
                    {oltMarkerImage ? <img src={oltMarkerImage} alt="" /> : <IconWifi size={19} />}
                  </span>
                  <span className="network-fiber-tree-summary-title">
                    <strong>{activeOlt.name}</strong>
                    <small>{[activeOlt.vendor, activeOlt.model || activeOlt.managementIp].filter(Boolean).join(' / ') || 'OLT'}</small>
                  </span>
                  <span className="network-fiber-tree-kpis">
                    <span>{activePonCount} PON</span>
                    <span>{activeNapCount} NAP</span>
                    <span>{activeJunctionCount} Junction</span>
                    <span>{activeLinkCount} Link</span>
                  </span>
                  <span className="network-fiber-tree-summary-actions">
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm network-fiber-tree-reset"
                      disabled={fiberMappingSaving}
                      onClick={resetFiberMapping}
                    >
                      <IconRefresh size={16} className="me-1" />Reset Topology
                    </button>
                  </span>
                </div>

                <div
                  className="network-fiber-tree-list"
                  role="tree"
                  aria-label={`${activeOlt.name} network topology`}
                  style={{
                    '--fiber-tree-row-height': `${fiberTreeRowHeight}px`,
                    '--fiber-tree-row-count': visibleRowsWithIndex.length
                  }}
                >
                  {treeConnectors.length > 0 && (
                    <svg
                      className="network-fiber-tree-connectors"
                      viewBox={`0 0 ${treeConnectorWidth} ${treeConnectorHeight}`}
                      width={treeConnectorWidth}
                      height={treeConnectorHeight}
                      aria-hidden="true"
                    >
                      {treeConnectors.map((connector) => (
                        <path
                          key={connector.id}
                          className={`network-fiber-tree-connector ${connector.selected ? 'selected' : ''} ${connector.directNapToNap ? 'direct-nap' : ''}`}
                          d={connector.d}
                          stroke={connector.color}
                          strokeDasharray={connector.dash}
                        />
                      ))}
                    </svg>
                  )}
                  {visibleRowsWithIndex.map(renderTreeRow)}
                  {!visibleRows.length && (
                    <div className="network-fiber-tree-empty">
                      No Network Topology rows match the current search for {activeOlt.name}.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="network-fiber-tree-empty">No OLTs are available yet. Add or capture an OLT first.</div>
            )}
          </div>
        </div>
        {floatingMenuNode && renderAddMenu(floatingMenuNode, floatingMenuPonId, floatingMenuAvailableNaps)}
      </div>
    );
  }

  function renderFiberMappingPage() {
    const oltMarkerImage = mapImageFor('olt');
    const napMarkerImage = mapImageFor('nap');
    const mappedNapKeys = new Set(
      fiberMappingCanvas.nodes
        .filter((node) => node.type === 'nap')
        .map((node) => node.key)
    );
    return renderFiberMappingTreeViewPage({ oltMarkerImage, napMarkerImage, mappedNapKeys });
    return (
      <div className="network-fiber-map-page">
          <div className="network-fiber-map-toolbar">
            <div className="network-fiber-map-toolbar-title">
              <span className="badge bg-teal-lt text-teal"><IconNetwork size={18} /></span>
              <div>
                <strong>Network Topology</strong>
                <span>
                  System-controlled tree / {fiberMappingCanvas.totals.olts} OLTs / {fiberMappingCanvas.totals.pons} PONs / {fiberMappingCanvas.totals.naps} NAPs / {fiberMappingCanvas.totals.junctions} junctions / {fiberMappingCanvas.totals.links} links
                </span>
              </div>
            </div>
            <div className="network-fiber-map-toolbar-actions">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => zoomFiberMapping(0.9)}
                title="Zoom out"
              >
                <IconZoomOut size={16} />
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => zoomFiberMapping(1.1)}
                title="Zoom in"
              >
                <IconZoomIn size={16} />
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={fiberMappingSaving}
                onClick={autoOrganizeFiberMapping}
              >
                <IconRadar size={16} className="me-1" />Refresh Layout
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={fiberMappingSaving}
                onClick={resetFiberMapping}
              >
                <IconRefresh size={16} className="me-1" />Reset Topology
              </button>
            </div>
          </div>
          <div className="network-fiber-map-workspace">
            <div
              ref={fiberMappingSurfaceRef}
              className={`network-fiber-map-scroll tree-mode ${fiberMappingPanning ? 'panning' : ''} ${fiberMappingCtrlPressed ? 'pan-ready' : ''}`}
              onPointerDown={startFiberMappingPan}
              onPointerMove={moveFiberMappingPan}
              onPointerUp={endFiberMappingPan}
              onPointerCancel={endFiberMappingPan}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="btn btn-outline-secondary btn-icon network-fiber-map-floating-reset"
                title="Reset view to first OLT"
                aria-label="Reset view to first OLT"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={resetFiberMappingView}
              >
                <IconMap size={18} />
              </button>
              <div
                className="network-fiber-map-canvas"
                style={{
                  width: fiberMappingCanvas.canvas.width,
                  height: fiberMappingCanvas.canvas.height,
                  transform: `translate(${fiberMappingView.panX}px, ${fiberMappingView.panY}px) scale(${fiberMappingView.zoom})`
                }}
              >
                <svg className="network-fiber-map-links" viewBox={`0 0 ${fiberMappingCanvas.canvas.width} ${fiberMappingCanvas.canvas.height}`}>
                  {fiberMappingCanvas.edges.map((edge) => {
                    const dash = edge.config.lineStyle === 'DASHED' ? '12 8' : edge.config.lineStyle === 'DOTTED' ? '2 8' : '';
                    const selected = edge.id === fiberMappingSelectedEdgeId;
                    const edgeProfile = fiberOptics.find((profile) => profile.id === edge.config?.fiberOpticLossId);
                    const strokeColor = edge.type === 'olt-pon' ? '#16a34a' : fiberLineColorForConfig(edge.config, edgeProfile);
                    const selectFiberEdge = (event) => {
                      event.stopPropagation();
                      openFiberLineModal(edge);
                    };
                    return (
                      <g key={edge.id} className={selected ? 'selected' : ''}>
                        <path
                          className="network-fiber-map-link-hit"
                          d={edge.path}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={selectFiberEdge}
                        />
                        <path
                          className="network-fiber-map-link"
                          d={edge.path}
                          stroke={strokeColor}
                          strokeDasharray={dash}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={selectFiberEdge}
                        />
                        <text
                          className="network-fiber-map-link-label"
                          x={edge.labelX}
                          y={edge.labelY - 8}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={selectFiberEdge}
                        >
                          {edge.napId && edge.budget.receivePowerDbm !== null ? `${edge.budget.receivePowerDbm.toFixed(2)} dBm` : edge.config.fiberOpticLossId ? edge.budget.wavelength : ''}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                {fiberMappingCanvas.nodes.map((node) => {
                  const NodeIcon = node.type === 'olt' ? IconWifi : node.type === 'pon' ? IconPlugConnected : IconBox;
                  const markerImage = node.type === 'olt' ? oltMarkerImage : node.type === 'nap' ? napMarkerImage : '';
                  const selected = fiberMappingSelectedNodeKeys.includes(node.key);
                  const isFiberContainer = node.type === 'nap' || node.type === 'junction';
                  const canAddDownstream = ['pon', 'nap', 'junction'].includes(node.type);
                  const expanded = fiberMappingExpandedContainerKeys.includes(node.key);
                  const menuPonId = node.type === 'pon' ? node.source.id : node.ponId || '';
                  const availableNaps = menuPonId
                    ? naps.filter((nap) => nap.ponPortId === menuPonId && !mappedNapKeys.has(fiberMapNodeKey('nap', nap.id)))
                    : [];
                  const assignedSplitters = isFiberContainer
                    ? (node.splitterAssignments || []).map((assignment) => {
                      const splitter = splittersById.get(assignment.splitterId);
                      return splitter ? { ...assignment, splitter } : null;
                    }).filter(Boolean)
                    : [];
                  const nodeStyle = { left: node.x, top: node.y, width: node.width, minHeight: node.height };
                  const nodeTypeLabel = node.type === 'olt' ? 'OLT' : node.type === 'pon' ? 'PON' : node.type === 'junction' ? 'Junction' : 'NAP';
                  const removeNode = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFiberMappingDeleteModalForKeys([node.key]);
                  };
                  return (
                    <div
                      key={node.key}
                      className={`network-fiber-map-node tree-node ${node.type} ${isFiberContainer ? `container-${expanded ? 'expanded' : 'collapsed'}` : ''} ${statusTone(node.status)} ${selected ? 'selected' : ''}`}
                      style={nodeStyle}
                      onClick={(event) => handleFiberMappingNodeClick(event, node, isFiberContainer)}
                    >
                      <div className="network-fiber-map-node-header">
                        <span className="network-fiber-map-node-art">
                          {markerImage ? <img src={markerImage} alt="" /> : <NodeIcon size={22} />}
                        </span>
                        <span className="network-fiber-map-node-title">
                          <strong>{node.label}</strong>
                          <small>{node.detail || nodeTypeLabel}</small>
                        </span>
                        <span className={`badge network-fiber-map-node-type ${node.type}`}>{nodeTypeLabel}</span>
                      </div>
                      {node.type === 'pon' && (
                        <div className="network-fiber-map-pon-meta">
                          <span><IconPlugConnected size={14} />{canonicalPonLabel(node.source)}</span>
                          <span>{formatDbm(node.source.moduleRxPowerDbm)}</span>
                          <span>{node.napCount || 0} NAPs</span>
                        </div>
                      )}
                      <div className="network-fiber-map-node-actions" onPointerDown={(event) => event.stopPropagation()}>
                        {canAddDownstream && (
                          <button
                            type="button"
                            className="badge network-action-badge bg-green-lt text-green border-0"
                            title={node.type === 'pon' ? 'Add from this PON' : `Add after this ${node.type === 'junction' ? 'Junction Box' : 'NAP'}`}
                            aria-label={node.type === 'pon' ? 'Add from this PON' : `Add after this ${node.type === 'junction' ? 'Junction Box' : 'NAP'}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setFiberMappingNapMenuPonId((current) => (current === node.key ? '' : node.key));
                            }}
                          >
                            <IconPlus size={17} />
                          </button>
                        )}
                        {isFiberContainer && (
                          <>
                            <button
                              type="button"
                              className="badge network-action-badge bg-azure-lt text-azure border-0"
                              title={`Open ${nodeTypeLabel} splitter canvas`}
                              aria-label={`Open ${nodeTypeLabel} splitter canvas`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openFiberMappingLayoutModal(node);
                              }}
                            >
                              <IconArrowsMaximize size={17} />
                            </button>
                            <button
                              type="button"
                              className="badge network-action-badge bg-red-lt text-red border-0"
                              title={`Remove ${nodeTypeLabel} branch`}
                              aria-label={`Remove ${nodeTypeLabel} branch`}
                              onClick={removeNode}
                            >
                              <IconTrash size={17} />
                            </button>
                          </>
                        )}
                      </div>
                      {fiberMappingNapMenuPonId === node.key && (
                        <div
                          className="network-fiber-map-nap-menu"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {menuPonId && (
                            <>
                              <strong>NAP boxes</strong>
                              {availableNaps.map((nap) => {
                                return (
                                  <button
                                    type="button"
                                    key={nap.id}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      addNapToFiberMapping(menuPonId, nap.id, node);
                                    }}
                                  >
                                    <span>{nap.name}</span>
                                    <small>{nap.barangay || nap.status}</small>
                                  </button>
                                );
                              })}
                              {!availableNaps.length && <span className="text-muted small">No remaining NAP boxes for this PON.</span>}
                            </>
                          )}
                          <strong>Junction box</strong>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              addJunctionBoxToFiberMapping(node);
                            }}
                          >
                            <span>Junction Box</span>
                            <small>{node.type === 'pon' ? 'Place before a NAP or branch path' : 'Continue the output path'}</small>
                          </button>
                        </div>
                      )}
                      {isFiberContainer && renderFiberContainerBody(node, assignedSplitters, expanded)}
                    </div>
                  );
                })}
                {!fiberMappingCanvas.nodes.length && (
                  <div className="network-fiber-map-empty">No OLTs are available yet. Add or capture an OLT first.</div>
                )}
              </div>
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
                                      <thead><tr><th className="network-expand-column"><span className="visually-hidden">Expand</span></th><th>PON</th><th>Technology / Status</th><th>NAP Boxes</th><th>Active</th><th>Splitters</th><th>Capacity</th></tr></thead>
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
                                                        <thead><tr><th>NAP</th><th>Status</th><th>Splitter</th><th>Splitters</th><th>Barangay</th><th>Coordinates</th><th className="network-actions-column">Actions</th></tr></thead>
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
    const tabs = meta.splitterTypes || defaultMeta.splitterTypes;
    return (
      <>
        <PageHeader
          title="Insertion Loss - Splitters"
          subtitle="Capture manufacturer-specific PLC, LCP, and FBT loss values. FBT records keep a ratio table with connector, deployment NAP branch, next NAP branch, and wavelength loss values."
        />
        <div className="row row-cards network-settings-page">
          {tabs.map((type) => (
            <div className="col-sm-6 col-xl-4" key={type}>
              <div className="card status-card">
                <div className="card-body">
                  <span className={`badge bg-${type === 'PLC' ? 'blue' : type === 'LCP' ? 'purple' : 'green'}-lt text-${type === 'PLC' ? 'blue' : type === 'LCP' ? 'purple' : 'green'} mb-3`}><IconNetwork size={18} /></span>
                  <div className="h1 mb-0">{splitterCounts[type] || 0}</div>
                  <div className="text-muted">{type} Splitters</div>
                </div>
              </div>
            </div>
          ))}
          <div className="col-12">
            <Card
              title={`${splitterTab} Splitters (${activeSplitters.length})`}
              icon={IconNetwork}
              className="network-table-card"
              actions={tableActions({ placeholder: 'Search splitter, maker, model', onNew: () => openNewFbt(splitterTab), newLabel: `New ${splitterTab}` })}
            >
              <ul className="nav nav-tabs mb-3 network-standard-tabs" role="tablist" aria-label="Splitter type">
                {tabs.map((type) => (
                  <li className="nav-item" key={type}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={splitterTab === type}
                      className={`nav-link ${splitterTab === type ? 'active' : ''}`}
                      onClick={() => setSplitterTab(type)}
                    >
                      {type}
                      <span className="badge bg-secondary-lt text-secondary ms-2">{splitterCounts[type] || 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="table-responsive">
                {splitterTab === 'FBT' ? (
                  <table className="table card-table table-vcenter network-table network-fbt-loss-table">
                    <thead><tr><th>Manufacturer / Company</th><th>Model</th><th>Ratios</th><th>Connector Loss</th><th>Deployment NAP Loss</th><th>Next NAP Loss</th><th className="network-actions-column">Actions</th></tr></thead>
                    <tbody>
                      {activeSplitters.map((splitter) => (
                        <tr key={splitter.id}>
                          <td><span className="network-table-value fw-semibold">{splitter.manufacturer || splitter.brand || '-'}</span></td>
                          <td>{splitter.model || '-'}</td>
                          <td><FbtRatioSummary rows={splitter.ratioRows} /></td>
                          <td><FbtRatioLossPreview rows={splitter.ratioRows} prefix="connectorLoss" /></td>
                          <td><FbtRatioLossPreview rows={splitter.ratioRows} prefix="currentNapLoss" /></td>
                          <td><FbtRatioLossPreview rows={splitter.ratioRows} prefix="nextNapLoss" /></td>
                          <RowActions label={splitter.name} onEdit={() => openEditFbt(splitter)} onDelete={() => remove(`/network-settings/fbts/${splitter.id}`, splitter.name)} />
                        </tr>
                      ))}
                      {!activeSplitters.length && <tr><td colSpan="7"><div className="empty">No FBT splitters match the current search.</div></td></tr>}
                    </tbody>
                  </table>
                ) : (
                  <table className="table card-table table-vcenter network-table">
                    <thead><tr><th>Manufacturer / Company</th><th>Model</th><th>Optical</th><th>Ports</th><th>Status</th><th className="network-actions-column">Actions</th></tr></thead>
                    <tbody>
                      {activeSplitters.map((splitter) => (
                        <tr key={splitter.id}>
                          <td><span className="network-table-value fw-semibold">{splitter.manufacturer || splitter.brand || '-'}</span></td>
                          <td>{splitter.model || '-'}</td>
                          <td>
                            <PlcRatioSummary splitter={splitter} />
                          </td>
                          <td>
                            {splitter.inputPorts || 1} in / {splitter.outputPorts || splitter.portCapacity || '-'} out
                            <span>{isPortLossSplitterType(splitter.splitterType) ? `${splitter.outputPorts || splitter.portCapacity || '-'} output ports` : `Slot ${splitter.portNumber || '-'}`}</span>
                          </td>
                          <td><StatusBadge value={splitter.status} /><span>{titleize(splitter.stage)}</span></td>
                          <RowActions label={splitter.name} onEdit={() => openEditFbt(splitter)} onDelete={() => remove(`/network-settings/fbts/${splitter.id}`, splitter.name)} />
                        </tr>
                      ))}
                      {!activeSplitters.length && <tr><td colSpan="6"><div className="empty">No {splitterTab} splitters match the current search.</div></td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  function renderFiberOpticLossPage() {
    const totalConfiguredCores = fiberOptics.reduce((total, profile) => total + normalizeFiberCoreCount(profile.coreCount, fiberCoreCountFromGroups(profile.colorGroups) || 12), 0);
    return (
      <>
        <PageHeader
          title="Insertion Loss - Fiber Optic"
          subtitle="Capture manufacturer-specific fiber attenuation, core counts, and color-group structures for fiber cables."
        />
        <div className="row row-cards network-settings-page">
          <div className="col-sm-6 col-xl-3">
            <div className="card status-card">
              <div className="card-body">
                <span className="badge bg-green-lt text-green mb-3"><IconNetwork size={18} /></span>
                <div className="h1 mb-0">{fiberOptics.length}</div>
                <div className="text-muted">Fiber Profiles</div>
              </div>
            </div>
          </div>
          <div className="col-sm-6 col-xl-3">
            <div className="card status-card">
              <div className="card-body">
                <span className="badge bg-blue-lt text-blue mb-3"><IconAntenna size={18} /></span>
                <div className="h1 mb-0">3</div>
                <div className="text-muted">Wavelengths</div>
              </div>
            </div>
          </div>
          <div className="col-sm-6 col-xl-3">
            <div className="card status-card">
              <div className="card-body">
                <span className="badge bg-orange-lt text-orange mb-3"><IconBox size={18} /></span>
                <div className="h1 mb-0">{totalConfiguredCores}</div>
                <div className="text-muted">Configured Cores</div>
              </div>
            </div>
          </div>
          <div className="col-12">
            <Card
              title={fiberOpticTab === 'list' ? `Fiber Optic Loss Profiles (${filteredFiberOptics.length})` : 'Fiber Optic Settings'}
              icon={fiberOpticTab === 'list' ? IconNetwork : IconBox}
              className="network-table-card"
              actions={fiberOpticTab === 'list' ? tableActions({ placeholder: 'Search fiber maker, model, wavelength', onNew: openNewFiberOptic, newLabel: 'New Fiber Optic' }) : null}
            >
              <ul className="nav nav-tabs mb-3 network-standard-tabs" role="tablist" aria-label="Fiber optic page">
                {[
                  ['list', 'List', filteredFiberOptics.length],
                  ['settings', 'Settings', null]
                ].map(([key, label, count]) => (
                  <li className="nav-item" key={key}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={fiberOpticTab === key}
                      className={`nav-link ${fiberOpticTab === key ? 'active' : ''}`}
                      onClick={() => setFiberOpticTab(key)}
                    >
                      {label}
                      {count !== null && <span className="badge bg-secondary-lt text-secondary ms-2">{count}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {fiberOpticTab === 'settings' ? (
                <FiberColorSettingsEditor
                  settings={fiberColorDraft}
                  onChange={setFiberColorDraft}
                  onSave={saveFiberColorSettings}
                  onReset={resetFiberColorSettingsDraft}
                  saving={fiberSettingsSaving}
                />
              ) : (
                <div className="table-responsive">
                  <table className="table card-table table-vcenter network-table network-fiber-loss-table">
                    <thead><tr><th>Model</th><th>Manufacturer / Company</th><th>Cores</th><th>Color Groups</th><th>Insertion Loss Per 1000m</th><th>Status</th><th className="network-actions-column">Actions</th></tr></thead>
                    <tbody>
                      {filteredFiberOptics.map((profile) => {
                        const coreCount = normalizeFiberCoreCount(profile.coreCount, fiberCoreCountFromGroups(profile.colorGroups) || 12);
                        const groupCount = fiberCoreCountUsesTubes(coreCount) ? (profile.colorGroupCount || (profile.colorGroups || []).length || 1) : 0;
                        const displayName = buildFiberOpticDisplayName(profile, coreCount);
                        return (
                          <tr key={profile.id}>
                            <td>
                              <span className="network-table-value fw-semibold">{profile.model || '-'}</span>
                              <div className="text-muted small">{displayName}</div>
                            </td>
                            <td>{profile.manufacturer || '-'}</td>
                            <td>
                              <span className="network-table-value">{coreCount} cores</span>
                              <div className="text-muted small">{groupCount ? `${groupCount} tube groups` : 'no tube'}</div>
                            </td>
                            <td><FiberColorGroupSummary profile={profile} /></td>
                            <td><LossTriplet record={profile} prefix="loss" unit="dB / 1000m" /></td>
                            <td><StatusBadge value={profile.status} /></td>
                            <RowActions label={displayName} onEdit={() => openEditFiberOptic(profile)} onDelete={() => remove(`/network-settings/fiber-optic-losses/${profile.id}`, displayName)} />
                          </tr>
                        );
                      })}
                      {!filteredFiberOptics.length && <tr><td colSpan="7"><div className="empty">No fiber optic insertion-loss profiles match the current search.</div></td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
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
    if (modalType === 'fiber-delete-object' && fiberDeleteTarget) {
      return (
        <div className="network-modal-backdrop" role="presentation">
          <form className="network-modal network-delete-object-modal" role="dialog" aria-modal="true" aria-labelledby="network-delete-object-title" onSubmit={confirmFiberMappingDelete}>
            <div className="network-modal-header">
              <h3 id="network-delete-object-title" className="network-modal-title">
                <IconAlertTriangle size={18} className="me-2 text-red" />
                Delete Network Topology Object
              </h3>
              <div className="network-modal-header-actions">
                <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={closeModal}><IconX size={18} /></button>
              </div>
            </div>
            <div className="network-modal-body">
              <div className="network-delete-object-summary">
                <span className="badge bg-red-lt text-red">{fiberDeleteTarget.primary.type}</span>
                <div>
                  <strong>{fiberDeleteTarget.primary.label}</strong>
                  <span>{fiberDeleteTarget.primary.detail}</span>
                </div>
              </div>
              <div className="network-delete-object-stats">
                <span><strong>{fiberDeleteTarget.affectedObjects.length}</strong> object{fiberDeleteTarget.affectedObjects.length === 1 ? '' : 's'}</span>
                <span><strong>{fiberDeleteTarget.downstreamCount}</strong> downstream</span>
                <span><strong>{fiberDeleteTarget.edgeCount}</strong> fiber link{fiberDeleteTarget.edgeCount === 1 ? '' : 's'}</span>
                <span><strong>{fiberDeleteTarget.splitterCount}</strong> splitter assignment{fiberDeleteTarget.splitterCount === 1 ? '' : 's'}</span>
              </div>
              <div className="network-delete-object-list">
                <span className="network-modal-section-title">Objects that will be removed</span>
                {fiberDeleteTarget.affectedObjects.map((item) => (
                  <div key={item.key} className="network-delete-object-row">
                    <span className="badge bg-secondary-lt text-secondary">{item.type}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="alert alert-warning mb-0">
                This removes the selected object and its downstream Network Topology branch. The original OLT, PON, and NAP records remain in Network Settings.
              </div>
            </div>
            <div className="network-modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>Cancel</button>
              <button type="submit" className="btn btn-danger"><IconTrash size={16} /> Delete Object</button>
            </div>
          </form>
        </div>
      );
    }

    if (modalType === 'fiber-layout') {
      const node = fiberMappingCanvas.nodes.find((canvasNode) => canvasNode.key === fiberMappingLayoutContainerKey);
      if (!node) return null;
      const assignedSplitters = (node.splitterAssignments || []).map((assignment) => {
        const splitter = splittersById.get(assignment.splitterId);
        return splitter ? { ...assignment, splitter } : null;
      }).filter(Boolean);
      const containerName = node.type === 'junction' ? 'Junction Box' : 'NAP';
      const incomingEdge = fiberLayoutIncomingEdgeId
        ? ponFiberLinkCanvas.edges.find((edge) => edge.id === fiberLayoutIncomingEdgeId) || fiberMappingCanvas.edges.find((edge) => edge.id === fiberLayoutIncomingEdgeId) || null
        : null;
      const incomingProfile = incomingEdge ? fiberOptics.find((profile) => profile.id === incomingEdge.config?.fiberOpticLossId) : null;
      const incomingConnectorType = incomingEdge?.config?.connectionType || 'FUSION';
      const incomingLineColor = incomingEdge ? fiberLineColorForConfig(incomingEdge.config, incomingProfile) : '#2563EB';
      return (
        <div className="network-modal-backdrop" role="presentation">
          <div className="network-modal network-fiber-layout-modal" role="dialog" aria-modal="true" aria-labelledby="network-fiber-layout-title">
            <div className="network-modal-header">
              <h3 id="network-fiber-layout-title" className="network-modal-title">
                <IconBox size={18} className="me-2 text-muted" />
                {containerName} Splitter Layout: {node.label}
              </h3>
              <div className="network-modal-header-actions">
                <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={closeFiberMappingLayoutModal}><IconX size={18} /></button>
              </div>
            </div>
            <div className="network-fiber-layout-modal-body">
              <div className="network-fiber-layout-summary">
                <div className="network-fiber-layout-meta">
                  <span className="badge bg-teal-lt text-teal">{assignedSplitters.length}</span>
                  <span>{node.detail || containerName}</span>
                  {fiberMappingSaving && <span className="text-muted">Saving...</span>}
                </div>
                {incomingEdge && (
                  <div className="network-fiber-layout-incoming" style={{ '--incoming-line-color': incomingLineColor }}>
                    <span className="network-fiber-layout-incoming-graphic">
                      <i />
                      <b className={fiberConnectionTypeClass(incomingConnectorType)} />
                    </span>
                    <span className="network-fiber-layout-incoming-copy">
                      <small>Incoming fiber</small>
                      <strong>{incomingEdge.label || incomingEdge.id}</strong>
                      <em>
                        {[
                          incomingEdge.lengthKm ? `${incomingEdge.lengthKm.toFixed(3)} km` : 'Length not set',
                          incomingProfile ? incomingProfile.manufacturer || incomingProfile.name || 'Fiber profile' : fiberConnectionTypeLabel(incomingConnectorType)
                        ].filter(Boolean).join(' / ')}
                      </em>
                    </span>
                  </div>
                )}
                <div className="network-fiber-layout-controls">
                  <button type="button" className="btn btn-outline-secondary btn-sm" title="Zoom out" aria-label="Zoom out" onClick={() => zoomFiberLayoutModal(0.9)}><IconZoomOut size={16} /></button>
                  <span>{Math.round(fiberLayoutModalView.zoom * 100)}%</span>
                  <button type="button" className="btn btn-outline-secondary btn-sm" title="Zoom in" aria-label="Zoom in" onClick={() => zoomFiberLayoutModal(1.1)}><IconZoomIn size={16} /></button>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetFiberLayoutModalView}>Reset</button>
                </div>
              </div>
              <div
                ref={fiberLayoutModalSurfaceRef}
                className={`network-fiber-layout-canvas-surface ${fiberLayoutModalView.panning ? 'panning' : ''}`}
                onWheel={wheelFiberLayoutModal}
                onPointerDown={startFiberLayoutModalPan}
                onPointerMove={moveFiberLayoutModalPan}
                onPointerUp={endFiberLayoutModalPan}
                onPointerCancel={endFiberLayoutModalPan}
              >
                <div
                  className="network-fiber-layout-canvas-stage"
                  data-fiber-layout-zoom={fiberLayoutModalView.zoom}
                  style={{
                    transform: `translate(${fiberLayoutModalView.panX}px, ${fiberLayoutModalView.panY}px) scale(${fiberLayoutModalView.zoom})`
                  }}
                >
                  {renderFiberInternalMiniCanvas(node.key, assignedSplitters, { modal: true, incomingEdge })}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
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
            <TextInput label="Mapping Label / Site" value={oltLocationForm.label} onChange={(value) => setOltLocationForm({ ...oltLocationForm, label: value })} />
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
                      <select
                        className="form-select form-select-sm network-coordinate-provider-select"
                        value={activeMapProviderId}
                        onChange={(event) => setMapTileMode(event.target.value)}
                        aria-label="Coordinate capture map provider"
                      >
                        {mapProviderOptions.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
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
                        type="text"
                        value={deviceForm.apiPassword}
                        required
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
          <TextInput
            label="Port No."
            type="number"
            min="1"
            value={ponForm.portNumber}
            onChange={(value) => setPonForm({
              ...ponForm,
              portNumber: value,
              colorHex: ponForm.id ? ponForm.colorHex : defaultPonColor(value, meta.ponColorPalette)
            })}
          />
          <TextInput label="Label" value={ponForm.label} onChange={(value) => setPonForm({ ...ponForm, label: value })} />
          <label className="form-label network-color-field">
            <span>PON Color</span>
            <div>
              <input
                type="color"
                value={normalizeHexColor(ponForm.colorHex, defaultPonColor(ponForm.portNumber, meta.ponColorPalette))}
                onChange={(event) => setPonForm({ ...ponForm, colorHex: event.target.value })}
              />
              <strong>{normalizeHexColor(ponForm.colorHex, defaultPonColor(ponForm.portNumber, meta.ponColorPalette))}</strong>
            </div>
          </label>
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
          <TextInput label="PON Module Brand" value={ponForm.moduleVendor} onChange={(value) => setPonForm({ ...ponForm, moduleVendor: value })} />
          <TextInput label="PON Power (dBm)" placeholder="-7.50" value={ponForm.moduleRxPowerDbm} onChange={(value) => setPonForm({ ...ponForm, moduleRxPowerDbm: value })} />
        </CrudModal>
      );
    }
    if (modalType === 'olt-pon-power') {
      return (
        <CrudModal title={`Power Module: ${ponPowerOlt?.name || 'OLT'} PONs`} icon={IconAntenna} onClose={closeModal} onSubmit={saveOltPonPower}>
          <TextInput label="PON Module Brand" value={ponForm.moduleVendor} onChange={(value) => setPonForm({ ...ponForm, moduleVendor: value })} />
          <TextInput label="PON Power (dBm)" placeholder="-7.50" value={ponForm.moduleRxPowerDbm} onChange={(value) => setPonForm({ ...ponForm, moduleRxPowerDbm: value })} />
        </CrudModal>
      );
    }
    if (modalType === 'nap') {
      return (
        <CrudModal title={napForm.id ? 'Edit NAP Box' : 'New NAP Box'} icon={IconBox} onClose={closeModal} onSubmit={saveNap} submitDisabled={napSaving} submitLabel={napSaving ? 'Saving...' : 'Save'}>
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
      const splitterType = normalizeSplitterType(fbtForm.splitterType);
      const ratioProfileOptions = ratioOptionsForSplitterType(splitterType, meta);
      const ratioProfiles = isPortLossSplitterType(splitterType)
        ? normalizeSplitterRatioProfiles(splitterType, fbtForm.ratioProfiles, fbtForm.splitRatio, fbtForm.portLosses, fbtForm.insertionLossDb, ratioProfileOptions)
        : [];
      const manufacturerValue = fbtForm.manufacturer || fbtForm.brand || '';
      const baseManufacturerOptions = splitterManufacturersByType[splitterType] || [];
      const manufacturerOptions = manufacturerValue && !baseManufacturerOptions.some((entry) => entry.toLowerCase() === manufacturerValue.toLowerCase())
        ? [manufacturerValue, ...baseManufacturerOptions]
        : baseManufacturerOptions;
      const updateManufacturer = (manufacturer) => {
        setFbtForm({ ...fbtForm, manufacturer, brand: manufacturer });
      };
      const updateRatioProfiles = (nextProfiles) => {
        const normalizedProfiles = normalizeSplitterRatioProfiles(splitterType, nextProfiles, nextProfiles[0]?.splitRatio || ratioProfileOptions[0], [], '', ratioProfileOptions);
        const primaryProfile = normalizedProfiles[0] || {};
        setFbtForm({
          ...fbtForm,
          ratioProfiles: normalizedProfiles,
          splitRatio: primaryProfile.splitRatio || fbtForm.splitRatio,
          outputPorts: primaryProfile.outputPorts ? String(primaryProfile.outputPorts) : fbtForm.outputPorts,
          portCapacity: primaryProfile.portCapacity ? String(primaryProfile.portCapacity) : fbtForm.portCapacity,
          portLosses: primaryProfile.portLosses || []
        });
      };
      return (
        <CrudModal title={fbtForm.id ? `Edit ${splitterType} Splitter` : `New ${splitterType} Splitter`} icon={IconNetwork} onClose={closeModal} onSubmit={saveFbt}>
          {splitterType === 'PLC' ? (
            <SplitterManufacturerInput
              value={manufacturerValue}
              options={manufacturerOptions}
              adding={splitterManufacturerAdding}
              onSelect={updateManufacturer}
              onAddNew={() => {
                setSplitterManufacturerAdding(true);
                updateManufacturer('');
              }}
              onChange={updateManufacturer}
            />
          ) : (
            <TextInput label="Manufacturer / Company" required value={manufacturerValue} onChange={updateManufacturer} />
          )}
          <TextInput label="Model" value={fbtForm.model} onChange={(value) => setFbtForm({ ...fbtForm, model: value })} />
          {splitterType === 'FBT' ? (
            <FbtRatioRowsEditor
              rows={fbtForm.ratioRows || []}
              visibleWavelengths={fbtForm.visibleWavelengths || defaultMeta.wavelengthsNm}
              onChange={(ratioRows) => setFbtForm({ ...fbtForm, ratioRows })}
              onVisibleWavelengthsChange={(visibleWavelengths) => setFbtForm({ ...fbtForm, visibleWavelengths })}
            />
          ) : (
            <>
              {isPortLossSplitterType(splitterType) ? (
                <PlcRatioProfilesEditor
                  splitterType={splitterType}
                  profiles={ratioProfiles}
                  options={ratioProfileOptions}
                  onChange={updateRatioProfiles}
                />
              ) : (
                <>
                  <SelectInput label="Split Ratio" value={fbtForm.splitRatio} options={meta.splitterRatios || defaultMeta.splitterRatios} onChange={(value) => setFbtForm({ ...fbtForm, splitRatio: value })} />
                  <TextInput label="Insertion Loss (dB)" placeholder="17.0" value={fbtForm.insertionLossDb} onChange={(value) => setFbtForm({ ...fbtForm, insertionLossDb: value })} />
                </>
              )}
              <SelectInput label="Connector" value={fbtForm.connectorType} options={meta.splitterConnectorTypes || defaultMeta.splitterConnectorTypes} onChange={(value) => setFbtForm({ ...fbtForm, connectorType: value })} />
              <SelectInput label="Package" value={fbtForm.packageType} options={meta.splitterPackageTypes || defaultMeta.splitterPackageTypes} onChange={(value) => setFbtForm({ ...fbtForm, packageType: value })} />
              {!isPortLossSplitterType(splitterType) && (
                <SelectInput label="Stage" value={fbtForm.stage} options={meta.splitterStages || defaultMeta.splitterStages} onChange={(value) => setFbtForm({ ...fbtForm, stage: value })} />
              )}
              <SelectInput label="Status" value={fbtForm.status} options={meta.splitterStatuses || meta.fbtStatuses || defaultMeta.splitterStatuses} onChange={(value) => setFbtForm({ ...fbtForm, status: value })} />
              {!isPortLossSplitterType(splitterType) && (
                <>
                  <TextInput label="Slot / Port No." type="number" min="1" value={fbtForm.portNumber} onChange={(value) => setFbtForm({ ...fbtForm, portNumber: value })} />
                  <TextInput label="Input Ports" type="number" min="1" value={fbtForm.inputPorts} onChange={(value) => setFbtForm({ ...fbtForm, inputPorts: value })} />
                  <TextInput label="Output Ports" type="number" min="1" value={fbtForm.outputPorts} onChange={(value) => setFbtForm({ ...fbtForm, outputPorts: value, portCapacity: value })} />
                </>
              )}
              {!isPortLossSplitterType(splitterType) && (
                <TextInput label="Serial Number" value={fbtForm.serialNumber} onChange={(value) => setFbtForm({ ...fbtForm, serialNumber: value })} />
              )}
              {!isPortLossSplitterType(splitterType) && (
                <TextInput label="Location Hint" value={fbtForm.locationHint} onChange={(value) => setFbtForm({ ...fbtForm, locationHint: value })} />
              )}
              <NotesInput label="Notes" value={fbtForm.notes} onChange={(value) => setFbtForm({ ...fbtForm, notes: value })} />
            </>
          )}
        </CrudModal>
      );
    }
    if (modalType === 'pon-fiber-link') {
      const ponNode = ponFiberLinkCanvas.pon;
      const pon = ponNode?.source || ponsById.get(fiberLinkCanvasPonId) || {};
      const olt = olts.find((row) => row.id === pon.oltId) || {};
      const napMarkerImage = mapImageFor('nap');
      return (
        <div className="network-modal-backdrop" role="presentation">
          <div className="network-modal network-pon-fiber-link-modal" role="dialog" aria-modal="true" aria-labelledby="network-pon-fiber-link-title">
            <div className="network-modal-header">
              <h3 id="network-pon-fiber-link-title" className="network-modal-title">
                <IconAntenna size={18} className="me-2 text-muted" />
                PON Fiber Link
              </h3>
              <button type="button" className="btn btn-icon btn-sm" title="Close" aria-label="Close" onClick={closeModal}><IconX size={18} /></button>
            </div>
            <div className="network-pon-fiber-link-body">
              <div className="network-pon-fiber-link-summary">
                <div>
                  <span className="text-muted small">Selected PON</span>
                  <strong>{[olt.name, canonicalPonLabel(pon)].filter(Boolean).join(' / ') || 'PON'}</strong>
                </div>
                <div>
                  <span className="text-muted small">Line Scale</span>
                  <strong>{ponFiberLinkCanvas.settings.minLinePixels}px - {ponFiberLinkCanvas.settings.maxLinePixels}px</strong>
                </div>
                <div>
                  <span className="text-muted small">Longest Fiber</span>
                  <strong>{ponFiberLinkCanvas.maxLengthKm ? `${ponFiberLinkCanvas.maxLengthKm.toFixed(3)} km` : 'Not set'}</strong>
                </div>
              </div>
              <div className="network-pon-fiber-link-controls">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => zoomPonFiberLinkCanvas(0.9)} title="Zoom out">
                  <IconZoomOut size={16} />
                </button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => zoomPonFiberLinkCanvas(1.1)} title="Zoom in">
                  <IconZoomIn size={16} />
                </button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetPonFiberLinkCanvasView}>
                  <IconRefresh size={16} className="me-1" />Reset View
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={fiberMappingSaving}
                  onClick={() => openFiberLinkSettingsModal({ returnPonId: fiberLinkCanvasPonId })}
                >
                  <IconSettings size={16} className="me-1" />Fiber Settings
                </button>
              </div>
              <div
                className={`network-pon-fiber-link-canvas-shell ${fiberLinkCanvasView.panning ? 'panning' : ''}`}
                onPointerDown={startPonFiberLinkCanvasPan}
                onPointerMove={movePonFiberLinkCanvasPan}
                onPointerUp={endPonFiberLinkCanvasPan}
                onPointerCancel={endPonFiberLinkCanvasPan}
              >
                <div
                  className="network-pon-fiber-link-stage"
                  style={{
                    width: `${ponFiberLinkCanvas.canvas.width}px`,
                    height: `${ponFiberLinkCanvas.canvas.height}px`,
                    transform: `translate(${fiberLinkCanvasView.panX}px, ${fiberLinkCanvasView.panY}px) scale(${fiberLinkCanvasView.zoom})`
                  }}
                >
                  <svg
                    className="network-pon-fiber-link-canvas"
                    viewBox={`0 0 ${ponFiberLinkCanvas.canvas.width} ${ponFiberLinkCanvas.canvas.height}`}
                    width={ponFiberLinkCanvas.canvas.width}
                    height={ponFiberLinkCanvas.canvas.height}
                    role="img"
                    aria-label={`${canonicalPonLabel(pon)} fiber link canvas`}
                  >
                    {ponFiberLinkCanvas.edges.map((edge) => {
                      const dash = edge.config?.lineStyle === 'DASHED'
                        ? '10 7'
                        : edge.config?.lineStyle === 'DOTTED'
                          ? '2 7'
                          : '';
                      const connectorType = edge.config?.connectionType || 'FUSION';
                      const profile = fiberOptics.find((row) => row.id === edge.config?.fiberOpticLossId);
                      const lineColor = fiberLineColorForConfig(edge.config, profile);
                      const coreLabel = profile ? fiberCoreLabelForConfig(edge.config, profile) : '';
                      const profileLabel = profile
                        ? [profile.manufacturer || profile.name || 'Fiber', coreLabel].filter(Boolean).join(' / ')
                        : 'Assign fiber';
                      const distanceLabel = edge.lengthKm ? `Total distance ${formatFiberDistanceKm(edge.lengthKm)}` : 'Distance not set';
                      return (
                        <g key={edge.id} className={`network-pon-fiber-link-edge ${edge.assigned ? 'assigned' : ''}`}>
                          <path
                            className="network-pon-fiber-link-hit"
                            d={edge.d}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openFiberLineModal(edge, { returnPonId: fiberLinkCanvasPonId });
                            }}
                          />
                          <path
                            className="network-pon-fiber-link-line"
                            d={edge.d}
                            stroke={lineColor}
                            strokeDasharray={dash}
                          />
                          <circle
                            className="network-pon-fiber-link-indicator"
                            cx={edge.midX}
                            cy={edge.midY}
                            r="9"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openFiberLineModal(edge, { returnPonId: fiberLinkCanvasPonId });
                            }}
                          />
                          <g
                            className="network-pon-fiber-link-connector-button"
                            role="button"
                            tabIndex="0"
                            aria-label={`Change ${edge.label || 'fiber line'} connector. Current ${fiberConnectionTypeLabel(connectorType)}`}
                            transform={`translate(${edge.endX - 12} ${edge.endY - 10})`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              cyclePonFiberLineConnection(edge);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              event.stopPropagation();
                              cyclePonFiberLineConnection(edge);
                            }}
                          >
                            <rect className="network-pon-fiber-link-connector-pad" x="-4" y="-4" width="32" height="28" rx="8" />
                            <g className={`network-pon-fiber-link-connector ${fiberConnectionTypeClass(connectorType)}`} transform="translate(2 2)">
                              {connectorType === 'FUSION' ? (
                                <ellipse cx="10" cy="8" rx="10" ry="7" />
                              ) : (
                                <rect x="1" y="1" width="18" height="14" rx="3" />
                              )}
                            </g>
                          </g>
                          <text className="network-pon-fiber-link-label" x={edge.midX} y={edge.midY - 14} textAnchor="middle">
                            {profileLabel}
                          </text>
                          <text className="network-pon-fiber-link-subtitle" x={edge.midX} y={edge.midY + 22} textAnchor="middle">
                            {distanceLabel}
                          </text>
                        </g>
                      );
                    })}
                    {ponFiberLinkCanvas.nodes.map((node) => {
                      const isNap = node.type === 'nap';
                      const isPon = node.type === 'pon';
                      const isFiberContainer = isNap || node.type === 'junction';
                      const NodeIcon = isPon ? IconPlugConnected : IconBox;
                      return (
                        <g
                          key={node.key}
                          className={`network-pon-fiber-link-node ${node.type} ${isFiberContainer ? 'is-clickable' : ''}`}
                          transform={`translate(${node.x} ${node.y})`}
                          role={isFiberContainer ? 'button' : undefined}
                          tabIndex={isFiberContainer ? 0 : undefined}
                          aria-label={isFiberContainer ? `Open splitter layout for ${node.label}` : undefined}
                          onPointerDown={isFiberContainer ? (event) => event.stopPropagation() : undefined}
                          onClick={isFiberContainer ? (event) => openPonFiberLinkNodeLayout(event, node) : undefined}
                          onKeyDown={isFiberContainer ? (event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            openPonFiberLinkNodeLayout(event, node);
                          } : undefined}
                        >
                          <rect width={node.width} height={node.height} rx="12" />
                          <foreignObject x="12" y="14" width="34" height="34">
                            <div className={`network-pon-fiber-link-node-art ${node.type}`}>
                              {isNap && napMarkerImage ? <img src={napMarkerImage} alt="" /> : <NodeIcon size={20} />}
                            </div>
                          </foreignObject>
                          <text x="56" y="30" className="network-pon-fiber-link-node-title">{node.label}</text>
                          <text x="56" y="52" className="network-pon-fiber-link-node-detail">{isPon ? `${node.napCount || 0} NAPs` : node.detail || titleize(node.type)}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                {!ponFiberLinkCanvas.edges.length && (
                  <div className="network-pon-fiber-link-empty">
                    Add NAP boxes under this PON in Network Topology before assigning fiber links.
                  </div>
                )}
              </div>
            </div>
            <div className="network-modal-footer">
              <button type="button" className="btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      );
    }
    if (modalType === 'fiber-link-settings') {
      return (
        <CrudModal
          title="Topology Fiber Settings"
          icon={IconSettings}
          onClose={closeFiberLinkSettingsModal}
          onSubmit={saveFiberLinkSettings}
          submitDisabled={fiberMappingSaving}
          submitLabel={fiberMappingSaving ? 'Saving...' : 'Save Settings'}
        >
          {fiberLinkSettingsError && <div className="col-12"><div className="alert alert-danger mb-0">{fiberLinkSettingsError}</div></div>}
          <div className="col-12">
            <div className="alert alert-info network-loss-guide mb-0">
              These values control how long saved fiber segments render inside each PON fiber-link canvas. The longest saved segment in the selected PON uses the maximum size.
            </div>
          </div>
          <TextInput label="Maximum Line Size (px)" type="number" min="160" max="1200" value={fiberLinkSettingsForm.maxLinePixels} onChange={(value) => setFiberLinkSettingsForm((current) => ({ ...current, maxLinePixels: value }))} />
          <TextInput label="Minimum Line Size (px)" type="number" min="40" max="1200" value={fiberLinkSettingsForm.minLinePixels} onChange={(value) => setFiberLinkSettingsForm((current) => ({ ...current, minLinePixels: value }))} />
        </CrudModal>
      );
    }
    if (modalType === 'fiber-line') {
      const edge = selectedFiberMappingEdge;
      const budget = edge ? fiberMappingEdgeBudget(fiberLineForm, edge, fiberOptics, splittersById, ponsById) : null;
      const selectedProfile = budget?.profile || fiberOptics.find((profile) => profile.id === fiberLineForm.fiberOpticLossId);
      const selectedCoreOptions = fiberCoreOptionsForProfile(selectedProfile);
      const selectedFiberCoreNumber = String(fiberCoreNumberForConfig(fiberLineForm, selectedProfile));
      const selectedFiberCore = selectedCoreOptions.find((core) => String(core.fiberNumber) === selectedFiberCoreNumber) || null;
      const selectedFiberCoreColor = fiberLineColorForConfig({ ...fiberLineForm, fiberCoreNumber: selectedFiberCoreNumber }, selectedProfile);
      return (
        <CrudModal
          title="Fiber Link"
          icon={IconNetwork}
          onClose={closeFiberLineModal}
          onSubmit={saveFiberLine}
          submitDisabled={fiberMappingSaving || !edge}
          submitLabel={fiberMappingSaving ? 'Saving...' : 'Save Fiber'}
        >
          {fiberLineFormError && <div className="col-12"><div className="alert alert-danger mb-0">{fiberLineFormError}</div></div>}
          {!edge && <div className="col-12"><div className="empty mb-0">Select a fiber line in Network Topology.</div></div>}
          {edge && (
            <>
              <div className="col-12">
                <div className="network-fiber-line-summary">
                  <div>
                    <span className="text-muted small">Selected Line</span>
                    <strong>{edge.label || edge.id}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    disabled={fiberMappingSaving || !fiberMapping.edges?.[edge.id]}
                    onClick={clearFiberLineAssignment}
                  >
                    Clear Fiber
                  </button>
                </div>
              </div>
              <SelectInput label="Fiber Optic" value={fiberLineForm.fiberOpticLossId} required onChange={(value) => updateFiberLineForm('fiberOpticLossId', value)}>
                <option value="">Select fiber profile</option>
                {fiberOptics.map((profile) => {
                  const coreCount = normalizeFiberCoreCount(profile.coreCount, fiberCoreCountFromGroups(profile.colorGroups) || 12);
                  return <option key={profile.id} value={profile.id}>{buildFiberOpticDisplayName(profile, coreCount)}</option>;
                })}
              </SelectInput>
              <div className="col-md-4">
                <label className="form-label">Fiber Core</label>
                <select
                  className="form-select"
                  disabled={!selectedCoreOptions.length}
                  value={selectedFiberCoreNumber}
                  onChange={(event) => updateFiberLineForm('fiberCoreNumber', event.target.value)}
                >
                  {selectedCoreOptions.length ? selectedCoreOptions.map((core) => (
                    <option key={core.fiberNumber} value={core.fiberNumber}>
                      Core {core.fiberNumber}{core.colorName ? ` / ${core.colorName}` : ''}
                    </option>
                  )) : <option value="1">Select fiber profile first</option>}
                </select>
                <div className="network-fiber-line-core-preview">
                  <span style={{ backgroundColor: selectedFiberCoreColor }} />
                  <small>{selectedFiberCore ? fiberCoreLabelForConfig({ fiberCoreNumber: selectedFiberCoreNumber }, selectedProfile) : 'Fiber color follows selected core'}</small>
                </div>
              </div>
              <SelectInput label="Wavelength" value={fiberLineForm.wavelengthNm} onChange={(value) => updateFiberLineForm('wavelengthNm', value)}>
                {(meta.wavelengthsNm || defaultMeta.wavelengthsNm).map((wavelength) => (
                  <option key={wavelength} value={wavelength}>{wavelength} nm</option>
                ))}
              </SelectInput>
              <SelectInput label="Line Style" value={fiberLineForm.lineStyle} onChange={(value) => updateFiberLineForm('lineStyle', value)}>
                {['SOLID', 'DASHED', 'DOTTED'].map((style) => <option key={style} value={style}>{titleize(style)}</option>)}
              </SelectInput>
              <TextInput label="Length (km)" placeholder="0.35" value={fiberLineForm.lengthKm} onChange={(value) => updateFiberLineForm('lengthKm', value)} />
              <TextInput label="Source Power (dBm)" placeholder={edge.ponId ? 'Uses PON power if blank' : '-3.00'} value={fiberLineForm.sourcePowerDbm} onChange={(value) => updateFiberLineForm('sourcePowerDbm', value)} />
              <TextInput label="Connector Loss (dB)" placeholder="0.50" value={fiberLineForm.connectorLossDb} onChange={(value) => updateFiberLineForm('connectorLossDb', value)} />
              <TextInput label="Splice Loss (dB)" placeholder="0.10" value={fiberLineForm.spliceLossDb} onChange={(value) => updateFiberLineForm('spliceLossDb', value)} />
              <div className="col-12">
                <div className="network-fiber-line-budget">
                  <div className="network-fiber-line-budget-header">
                    <strong>Optical Budget Preview</strong>
                    <span>
                      {selectedProfile
                        ? buildFiberOpticDisplayName(selectedProfile, normalizeFiberCoreCount(selectedProfile.coreCount, fiberCoreCountFromGroups(selectedProfile.colorGroups) || 12))
                        : 'No fiber selected'}
                    </span>
                  </div>
                  <div className="network-fiber-line-budget-grid">
                    <div><span>Wavelength</span><strong>{budget?.wavelength || '-'} nm</strong></div>
                    <div><span>Length</span><strong>{budget ? `${budget.lengthKm.toFixed(3)} km` : '-'}</strong></div>
                    <div><span>Fiber Loss</span><strong>{budget ? `${budget.fiberLossDb.toFixed(2)} dB` : '-'}</strong></div>
                    <div><span>Extra Loss</span><strong>{budget ? `${(budget.connectorLossDb + budget.spliceLossDb).toFixed(2)} dB` : '-'}</strong></div>
                    <div><span>Splitter Loss</span><strong>{budget ? `${budget.splitterLossDb.toFixed(2)} dB` : '-'}</strong></div>
                    <div><span>Receive Power</span><strong>{budget?.receivePowerDbm === null || budget?.receivePowerDbm === undefined ? '-' : `${budget.receivePowerDbm.toFixed(2)} dBm`}</strong></div>
                  </div>
                </div>
              </div>
              <NotesInput label="Notes" value={fiberLineForm.notes} onChange={(value) => updateFiberLineForm('notes', value)} />
            </>
          )}
        </CrudModal>
      );
    }
    if (modalType === 'fiber-optic') {
      return (
        <CrudModal title={fiberOpticForm.id ? 'Edit Fiber Optic Loss' : 'New Fiber Optic Loss'} icon={IconNetwork} onClose={closeModal} onSubmit={saveFiberOptic}>
          {fiberOpticFormError && <div className="col-12"><div className="alert alert-danger mb-0">{fiberOpticFormError}</div></div>}
          <TextInput label="Manufacturer / Company" value={fiberOpticForm.manufacturer} required onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, manufacturer: value })} />
          <TextInput label="Model" value={fiberOpticForm.model} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, model: value })} />
          <SelectInput label="Status" value={fiberOpticForm.status} options={meta.fiberOpticStatuses || defaultMeta.fiberOpticStatuses} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, status: value })} />
          <FiberCoreCountChoice
            value={fiberOpticForm.coreCount}
            options={meta.fiberCoreCountOptions || defaultMeta.fiberCoreCountOptions}
            onChange={changeFiberCoreCount}
          />
          <div className="col-12">
            <div className="alert alert-info network-loss-guide mb-0">
              Enter at least one cable manufacturer attenuation specification per 1000m. Fiber and tube colors default to the saved {fiberColorSettings.standardName || 'TIA-598'} sequence and can be adjusted per profile.
            </div>
          </div>
          <FiberColorGroupEditor groups={fiberOpticForm.colorGroups} settings={fiberColorSettings} onChange={changeFiberColorGroups} />
          <TextInput label="1310 nm Loss / 1000m (dB)" value={fiberOpticForm.loss1310DbPer1000m} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, loss1310DbPer1000m: value })} />
          <TextInput label="1490 nm Loss / 1000m (dB)" value={fiberOpticForm.loss1490DbPer1000m} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, loss1490DbPer1000m: value })} />
          <TextInput label="1550 nm Loss / 1000m (dB)" value={fiberOpticForm.loss1550DbPer1000m} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, loss1550DbPer1000m: value })} />
          <NotesInput label="Notes" value={fiberOpticForm.notes} onChange={(value) => setFiberOpticForm({ ...fiberOpticForm, notes: value })} />
        </CrudModal>
      );
    }
    return null;
  }

  return (
    <>
      {message && (
        <div className="network-toast-region" role="status" aria-live="polite">
          <div className="network-success-toast">
            <span className="network-success-alert-icon" aria-hidden="true"><IconCircleCheck size={18} /></span>
            <span>{message}</span>
            <button
              type="button"
              className="btn btn-icon btn-sm network-toast-close"
              title="Close"
              aria-label="Close success message"
              onClick={() => setMessage('')}
            >
              <IconX size={16} />
            </button>
          </div>
        </div>
      )}
      {error && <div className="alert alert-danger mb-3">{error}</div>}
      {activeSection === 'overview' && renderOverview()}
      {activeSection === 'mikrotik-settings' && renderDevicesPage()}
      {activeSection === 'pppoe' && renderPppoeAccountsPage()}
      {activeSection === 'olt-settings' && renderDevicesPage()}
      {activeSection === 'map' && renderMapPage()}
      {activeSection === 'serviceability' && renderServiceabilityPage()}
      {activeSection === 'fiber-mapping' && renderFiberMappingPage()}
      {activeSection === 'olts' && renderOltPonPage()}
      {activeSection === 'onus' && renderOnusPage()}
      {activeSection === 'naps' && renderNapPage()}
      {activeSection === 'fbts' && renderFbtPage()}
      {activeSection === 'fiber-optic-loss' && renderFiberOpticLossPage()}
      {renderModal()}
      {renderCaptureModal()}
    </>
  );
}
