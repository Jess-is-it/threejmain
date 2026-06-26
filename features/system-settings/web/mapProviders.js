export const DEFAULT_MAP_PROVIDER_ID = 'esri-streets';

export const DEFAULT_MAP_PROVIDERS = [
  {
    id: 'esri-streets',
    label: 'Esri Streets',
    type: 'street',
    tileUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Street Map',
    minZoom: 1,
    maxZoom: 19,
    enabled: true,
    builtIn: true,
    requiresApiKey: false,
    apiKey: '',
    notes: 'Default street map provider. Some high zoom areas may stop before the nominal service limit.'
  },
  {
    id: 'esri-satellite',
    label: 'Esri Satellite',
    type: 'satellite',
    tileUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Imagery',
    minZoom: 1,
    maxZoom: 19,
    enabled: true,
    builtIn: true,
    requiresApiKey: false,
    apiKey: '',
    notes: 'Satellite imagery. Some areas return provider placeholders at high zoom.'
  },
  {
    id: 'osm-standard',
    label: 'OpenStreetMap',
    type: 'street',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'OpenStreetMap contributors',
    minZoom: 1,
    maxZoom: 19,
    enabled: true,
    builtIn: true,
    requiresApiKey: false,
    apiKey: '',
    notes: 'Use responsibly; public OSM tiles are not intended for heavy production load.'
  },
  {
    id: 'google-roadmap',
    label: 'Google Roadmap',
    type: 'street',
    tileUrl: 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={sessionToken}&key={apiKey}',
    attribution: 'Google Maps',
    minZoom: 0,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    sessionProvider: 'google-map-tiles',
    googleMapType: 'roadmap',
    googleLanguage: 'en-US',
    googleRegion: 'PH',
    notes: 'Requires Google Maps Platform Map Tiles API. The browser creates a Google tile session before loading tiles.'
  },
  {
    id: 'google-satellite',
    label: 'Google Satellite',
    type: 'satellite',
    tileUrl: 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={sessionToken}&key={apiKey}',
    attribution: 'Google Maps',
    minZoom: 0,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    sessionProvider: 'google-map-tiles',
    googleMapType: 'satellite',
    googleLanguage: 'en-US',
    googleRegion: 'PH',
    notes: 'Requires Google Maps Platform Map Tiles API. Satellite imagery availability can vary by area.'
  },
  {
    id: 'tomtom-basic',
    label: 'TomTom Basic',
    type: 'street',
    tileUrl: 'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key={apiKey}',
    attribution: 'TomTom',
    minZoom: 1,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    notes: 'Requires a TomTom API key.'
  },
  {
    id: 'maptiler-streets',
    label: 'MapTiler Streets',
    type: 'street',
    tileUrl: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={apiKey}',
    attribution: 'MapTiler, OpenStreetMap contributors',
    minZoom: 1,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    notes: 'Requires a MapTiler API key.'
  },
  {
    id: 'maptiler-satellite',
    label: 'MapTiler Satellite',
    type: 'satellite',
    tileUrl: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={apiKey}',
    attribution: 'MapTiler',
    minZoom: 1,
    maxZoom: 20,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    notes: 'Requires a MapTiler API key.'
  },
  {
    id: 'mapbox-streets',
    label: 'Mapbox Streets',
    type: 'street',
    tileUrl: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={apiKey}',
    attribution: 'Mapbox, OpenStreetMap',
    minZoom: 1,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    notes: 'Requires a Mapbox public access token.'
  },
  {
    id: 'mapbox-satellite-streets',
    label: 'Mapbox Satellite Streets',
    type: 'hybrid',
    tileUrl: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token={apiKey}',
    attribution: 'Mapbox',
    minZoom: 1,
    maxZoom: 22,
    enabled: false,
    builtIn: true,
    requiresApiKey: true,
    apiKey: '',
    notes: 'Requires a Mapbox public access token.'
  }
];

export const DEFAULT_MAP_PROVIDER_SETTINGS = {
  defaultProviderId: DEFAULT_MAP_PROVIDER_ID,
  providers: DEFAULT_MAP_PROVIDERS
};

export const MAP_PROVIDER_TYPES = [
  { id: 'street', label: 'Street' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'custom', label: 'Custom' }
];

function cleanText(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function toNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function normalizeMapProviderId(value, fallback = '') {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function normalizeMapProvider(raw = {}, preset = null) {
  const merged = { ...(preset || {}), ...(raw || {}) };
  const id = normalizeMapProviderId(merged.id, preset?.id || '');
  const type = MAP_PROVIDER_TYPES.some((item) => item.id === merged.type) ? merged.type : (preset?.type || 'custom');
  const requiresApiKey = Boolean(merged.requiresApiKey || String(merged.tileUrl || '').includes('{apiKey}') || String(merged.tileUrl || '').includes('{token}'));
  const googleLayerTypes = Array.isArray(merged.googleLayerTypes)
    ? merged.googleLayerTypes.map((item) => cleanText(item)).filter(Boolean)
    : [];
  return {
    id,
    label: cleanText(merged.label, preset?.label || id || 'Map Provider'),
    type,
    tileUrl: cleanText(merged.tileUrl, preset?.tileUrl || ''),
    attribution: cleanText(merged.attribution, preset?.attribution || ''),
    minZoom: toNumber(merged.minZoom, preset?.minZoom ?? 1, 0, 24),
    maxZoom: toNumber(merged.maxZoom, preset?.maxZoom ?? 19, 1, 24),
    enabled: typeof merged.enabled === 'boolean' ? merged.enabled : Boolean(preset?.enabled),
    builtIn: Boolean(preset?.builtIn || merged.builtIn),
    requiresApiKey,
    apiKey: cleanText(merged.apiKey, ''),
    sessionProvider: cleanText(merged.sessionProvider, preset?.sessionProvider || ''),
    googleMapType: cleanText(merged.googleMapType, preset?.googleMapType || ''),
    googleLanguage: cleanText(merged.googleLanguage, preset?.googleLanguage || 'en-US'),
    googleRegion: cleanText(merged.googleRegion, preset?.googleRegion || 'PH').toUpperCase(),
    googleLayerTypes,
    googleOverlay: Boolean(merged.googleOverlay),
    notes: cleanText(merged.notes, preset?.notes || '')
  };
}

export function normalizeMapProviderSettings(raw = {}) {
  const presetById = new Map(DEFAULT_MAP_PROVIDERS.map((provider) => [provider.id, provider]));
  const provided = Array.isArray(raw?.providers) ? raw.providers : [];
  const providedById = new Map();
  provided.forEach((provider) => {
    const id = normalizeMapProviderId(provider?.id);
    if (id && !providedById.has(id)) providedById.set(id, provider);
  });

  const providers = DEFAULT_MAP_PROVIDERS.map((preset) => normalizeMapProvider(providedById.get(preset.id), preset));
  providedById.forEach((provider, id) => {
    if (!presetById.has(id)) providers.push(normalizeMapProvider(provider));
  });

  const enabledConfigured = providers.filter(isProviderUsable);
  const defaultProviderId = normalizeMapProviderId(raw?.defaultProviderId || raw?.default_provider_id, DEFAULT_MAP_PROVIDER_ID);
  const defaultExists = enabledConfigured.some((provider) => provider.id === defaultProviderId);
  return {
    defaultProviderId: defaultExists ? defaultProviderId : (enabledConfigured[0]?.id || DEFAULT_MAP_PROVIDER_ID),
    providers
  };
}

export function isProviderConfigured(provider) {
  if (!provider?.tileUrl) return false;
  if (!provider.requiresApiKey) return true;
  return Boolean(cleanText(provider.apiKey));
}

export function isProviderUsable(provider) {
  return Boolean(provider?.enabled && isProviderConfigured(provider));
}

export function enabledMapProviders(settings, acceptedTypes = null) {
  const normalized = normalizeMapProviderSettings(settings);
  const types = acceptedTypes ? new Set(Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes]) : null;
  return normalized.providers.filter((provider) => isProviderUsable(provider) && (!types || types.has(provider.type)));
}

export function mapProviderById(settings, providerId, acceptedTypes = null) {
  const normalized = normalizeMapProviderSettings(settings);
  const types = acceptedTypes ? new Set(Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes]) : null;
  const provider = normalized.providers.find((item) => item.id === providerId);
  if (provider && isProviderUsable(provider) && (!types || types.has(provider.type))) return provider;
  return enabledMapProviders(normalized, acceptedTypes)[0] || normalizeMapProvider(DEFAULT_MAP_PROVIDERS[0], DEFAULT_MAP_PROVIDERS[0]);
}

export function defaultMapProvider(settings, acceptedTypes = null) {
  const normalized = normalizeMapProviderSettings(settings);
  return mapProviderById(normalized, normalized.defaultProviderId, acceptedTypes);
}

export function mapProviderTypeLabel(type) {
  return MAP_PROVIDER_TYPES.find((item) => item.id === type)?.label || 'Custom';
}

export function mapProviderNeedsSession(provider) {
  return Boolean(
    provider?.sessionProvider === 'google-map-tiles'
    || String(provider?.tileUrl || '').includes('{sessionToken}')
    || String(provider?.tileUrl || '').includes('{session}')
  );
}

export function mapProviderWithSession(provider, session = null) {
  if (!provider) return provider;
  const sessionToken = session?.session || session?.token || session?.sessionToken || provider.sessionToken || '';
  return sessionToken ? { ...provider, sessionToken, session } : provider;
}

export async function createMapProviderSession(provider) {
  if (!mapProviderNeedsSession(provider)) return null;
  if (provider.sessionProvider !== 'google-map-tiles') return null;
  if (!provider.apiKey) throw new Error('Google Map Tiles API key is required.');
  const body = {
    mapType: provider.googleMapType || 'roadmap',
    language: provider.googleLanguage || 'en-US',
    region: provider.googleRegion || 'PH'
  };
  if (Array.isArray(provider.googleLayerTypes) && provider.googleLayerTypes.length) {
    body.layerTypes = provider.googleLayerTypes;
    body.overlay = Boolean(provider.googleOverlay);
  }
  const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(provider.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session) {
    throw new Error(data.error?.message || data.message || `Google map session failed (${response.status})`);
  }
  return data;
}

function quadKey(tileX, tileY, zoom) {
  let key = '';
  for (let index = zoom; index > 0; index -= 1) {
    let digit = 0;
    const mask = 1 << (index - 1);
    if ((tileX & mask) !== 0) digit += 1;
    if ((tileY & mask) !== 0) digit += 2;
    key += String(digit);
  }
  return key;
}

export function mapProviderTileUrl(provider, x, y, z, session = null) {
  if (!provider?.tileUrl) return '';
  const zoom = toNumber(z, 1, 0, 24);
  const tileCount = 2 ** zoom;
  const normalizedX = ((Math.floor(Number(x) || 0) % tileCount) + tileCount) % tileCount;
  const normalizedY = Math.max(0, Math.min(tileCount - 1, Math.floor(Number(y) || 0)));
  const sessionToken = session?.session || session?.token || session?.sessionToken || provider.sessionToken || '';
  if (mapProviderNeedsSession(provider) && !sessionToken) return '';
  const subdomains = Array.isArray(provider.subdomains)
    ? provider.subdomains
    : String(provider.subdomains || 'abc').split('').filter(Boolean);
  const subdomain = subdomains.length ? subdomains[Math.abs(normalizedX + normalizedY) % subdomains.length] : '';
  return provider.tileUrl
    .replaceAll('{z}', String(zoom))
    .replaceAll('{x}', String(normalizedX))
    .replaceAll('{y}', String(normalizedY))
    .replaceAll('{s}', subdomain)
    .replaceAll('{q}', quadKey(normalizedX, normalizedY, zoom))
    .replaceAll('{quadkey}', quadKey(normalizedX, normalizedY, zoom))
    .replaceAll('{apiKey}', provider.apiKey || '')
    .replaceAll('{token}', provider.apiKey || '')
    .replaceAll('{sessionToken}', sessionToken)
    .replaceAll('{session}', sessionToken);
}
