export const WEB_BASE_PATH = (import.meta.env.VITE_WEB_BASE_PATH as string) || '/customer-profiling';
export const API_BASE_PATH =
  (import.meta.env.VITE_API_BASE_PATH as string) || '/api/customer-profiling';
export const API_V1_BASE = `${API_BASE_PATH}/v1`;
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string) || '0.1.4';
