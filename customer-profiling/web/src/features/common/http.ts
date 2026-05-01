import { API_BASE_PATH, API_V1_BASE } from '../../config/env';

export interface ListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) {
        message = payload.message.join(', ');
      } else if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const api = {
  customers: `${API_V1_BASE}/customers`,
  customersOverview: `${API_V1_BASE}/customers/overview`,
  customersBulkTemplate: `${API_V1_BASE}/customers/bulk-upload-template`,
  customersBulkPreview: `${API_V1_BASE}/customers/bulk-upload-preview`,
  customersBulkValidatedReport: `${API_V1_BASE}/customers/bulk-upload-validated-report`,
  auditLogs: `${API_V1_BASE}/audit-logs`,
  health: `${API_BASE_PATH}/health`,
  docs: `${API_BASE_PATH}/docs`,
  docsJson: `${API_BASE_PATH}/docs-json`,
};
