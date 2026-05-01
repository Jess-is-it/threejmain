import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api, fetchJson, ListResponse } from '../common/http';
import { Customer } from './types';
import { toast } from '../../hooks/use-toast';

const PROVINCES = ['CAGAYAN', 'ISABELA'] as const;

const MUNICIPALITIES_BY_PROVINCE: Record<string, readonly string[]> = {
  CAGAYAN: [
    'ABULUG',
    'ALCALA',
    'ALLACAPAN',
    'AMULUNG',
    'APARRI',
    'BAGGAO',
    'BALLESTEROS',
    'BUGUEY',
    'CALAYAN',
    'CAMALANIUGAN',
    'CLAVERIA',
    'ENRILE',
    'GATTARAN',
    'GONZAGA',
    'IGUIG',
    'LAL-LO',
    'LASAM',
    'PAMPLONA',
    'PENABLANCA',
    'PIAT',
    'RIZAL',
    'SANCHEZ-MIRA',
    'SANTA ANA',
    'SANTA PRAXEDES',
    'SANTA TERESITA',
    'SANTO NINO',
    'SOLANA',
    'TUAO',
    'TUGUEGARAO CITY',
  ],
  ISABELA: [
    'ALICIA',
    'ANGADANAN',
    'AURORA',
    'BENITO SOLIVEN',
    'BURGOS',
    'CABAGAN',
    'CABATUAN',
    'CAUAYAN CITY',
    'CORDON',
    'DINAPIGUE',
    'DIVILACAN',
    'ECHAGUE',
    'GAMU',
    'ILAGAN CITY',
    'JONES',
    'LUNA',
    'MACONACON',
    'MALLIG',
    'NAGUILIAN',
    'PALANAN',
    'QUEZON',
    'QUIRINO',
    'RAMON',
    'REINA MERCEDES',
    'ROXAS',
    'SAN AGUSTIN',
    'SAN GUILLERMO',
    'SAN ISIDRO',
    'SAN MANUEL',
    'SAN MARIANO',
    'SAN MATEO',
    'SAN PABLO',
    'SANTA MARIA',
    'SANTIAGO CITY',
    'SANTO TOMAS',
    'TUMAUINI',
  ],
};

const BARANGAYS_BY_PROVINCE_MUNICIPALITY: Record<string, readonly string[]> = {
  'CAGAYAN::ENRILE': [
    'ALIBAGO',
    'BARANGAY I',
    'BARANGAY II',
    'BARANGAY III',
    'BARANGAY III-A',
    'BARANGAY IV',
    'BATU',
    'DIVISORIA',
    'INGA',
    'LANNA',
    'LEMU NORTE',
    'LEMU SUR',
    'LIWAN NORTE',
    'LIWAN SUR',
    'MADDARULUG NORTE',
    'MADDARULUG SUR',
    'MAGALALAG EAST',
    'MAGALALAG WEST',
    'MARRACURU',
    'ROMA NORTE',
    'ROMA SUR',
    'SAN ANTONIO',
  ],
  'ISABELA::SANTA MARIA': [
    'BANGAD',
    'BUENAVISTA',
    'CALAMAGUI EAST',
    'CALAMAGUI NORTH',
    'CALAMAGUI WEST',
    'DIVISORIA',
    'LINGALING',
    'MOZZOZZIN NORTH',
    'MOZZOZZIN SUR',
    'NAGANACAN',
    'POBLACION 1',
    'POBLACION 2',
    'POBLACION 3',
    'POBLACION GK',
    'POBLACION BLISS',
    'QUINAGABIAN',
    'SAN ANTONIO',
    'SAN ISIDRO EAST',
    'SAN ISIDRO WEST',
    'SAN RAFAEL EAST',
    'SAN RAFAEL WEST',
    'VILLABUENA',
  ],
  'ISABELA::CABAGAN': [
    'AGGUB',
    'ANNARONAN',
    'ANAO',
    'ANGANCASILIAN',
    'BALASIG',
    'CATABAYUNGAN',
    'CENTRO',
    'GARITA',
    'LUQUILU',
    'MAGLETICIA',
    'MASIPI EAST',
    'MASIPI WEST',
    'NGARAG',
    'SAN ANTONIO',
    'SAN BERNARDO',
    'SAN JUAN',
    'SAN PABLO',
    'SANTA MARIA',
    'SARANAY',
    'SAUI',
    'TALLAG',
    'UGAD',
    'UNION',
    'VILLAFLOR',
    'VILLAHERMOSA',
    'VILLA IMELDA',
    'VILLA JESUSA',
  ],
};

function normalizeExternalUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

interface BulkUploadPreview {
  templateValid: boolean;
  missingHeaders: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Array<{
    row: number;
    valid: boolean;
    errors: string[];
    preview: {
      firstName: string;
      lastName: string;
      contactNumber: string;
      email: string;
      province: string;
      city: string;
      barangay: string;
      customerType: string;
    };
  }>;
}

interface BulkUploadResult {
  totalRows: number;
  created: number;
  failed: number;
  failures: Array<{ row: number; message: string }>;
  invalidReportFilename?: string | null;
  invalidReportBase64?: string | null;
}

export default function CustomersListPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkPreviewTableRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [province, setProvince] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [selectedBulkFile, setSelectedBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<BulkUploadPreview | null>(null);
  const [bulkUploadResult, setBulkUploadResult] = useState<BulkUploadResult | null>(null);
  const [bulkPreviewPage, setBulkPreviewPage] = useState(1);
  const [bulkPreviewPageSize, setBulkPreviewPageSize] = useState(100);
  const municipalityOptions = province ? MUNICIPALITIES_BY_PROVINCE[province] || [] : [];
  const barangayOptions =
    province && municipality
      ? BARANGAYS_BY_PROVINCE_MUNICIPALITY[`${province}::${municipality}`] || []
      : [];

  useEffect(() => {
    setMunicipality(province === 'CAGAYAN' ? 'ENRILE' : '');
    setBarangay('');
  }, [province]);

  useEffect(() => {
    setBarangay('');
  }, [municipality]);

  useEffect(() => {
    if (bulkPreviewTableRef.current) {
      bulkPreviewTableRef.current.scrollTop = 0;
    }
  }, [bulkPreviewPage, bulkPreviewPageSize]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
    });
    if (search.trim()) {
      params.set('search', search.trim());
    }
    if (province.trim()) {
      params.set('province', province.trim());
    }
    if (municipality.trim()) {
      params.set('city', municipality.trim());
    }
    if (barangay.trim()) {
      params.set('barangay', barangay.trim());
    }
    return params.toString();
  }, [page, pageSize, search, province, municipality, barangay, sortBy, sortDir]);

  const query = useQuery({
    queryKey: ['customers', queryString],
    queryFn: () => fetchJson<ListResponse<Customer>>(`${api.customers}?${queryString}`),
  });

  const bulkPreviewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetchJson<BulkUploadPreview>(api.customersBulkPreview, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (result) => {
      setBulkPreview(result);
      setBulkUploadResult(null);
      setBulkPreviewPage(1);
      toast({
        title: result.invalidRows > 0 ? 'Validation completed with issues' : 'Validation successful',
        description: `Valid rows: ${result.validRows}, Invalid rows: ${result.invalidRows}`,
        variant: result.invalidRows > 0 ? 'warning' : 'success',
      });
    },
    onError: (error: Error) => {
      setBulkPreview(null);
      toast({
        title: 'Validation failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetchJson<BulkUploadResult>(`${api.customers}/bulk-upload`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (result) => {
      setBulkUploadResult(result);
      toast({
        title: 'Bulk upload completed',
        description: `Created: ${result.created}, Failed: ${result.failed}`,
        variant: result.failed > 0 ? 'warning' : 'success',
      });
      query.refetch();
    },
    onError: (error: Error) => {
      toast({
        title: 'Bulk upload failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const downloadTemplateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(api.customersBulkTemplate, {
        method: 'GET',
        headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
      if (!response.ok) {
        throw new Error(`Unable to download template: ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const matchedFileName = disposition.match(/filename="?([^"]+)"?/i)?.[1];
      const filename = matchedFileName || 'customer-bulk-upload-template.xlsx';

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    },
    onError: (error: Error) => {
      toast({
        title: 'Download failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const downloadValidatedFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(api.customersBulkValidatedReport, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        let message = `Unable to download validated file: ${response.status}`;
        try {
          const payload = (await response.json()) as { message?: string | string[] };
          if (Array.isArray(payload.message)) {
            message = payload.message.join(', ');
          } else if (payload.message) {
            message = payload.message;
          }
        } catch {
          // Keep fallback message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const matchedFileName = disposition.match(/filename="?([^"]+)"?/i)?.[1];
      const filename = matchedFileName || 'customer-bulk-upload-validated.xlsx';

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    },
    onError: (error: Error) => {
      toast({
        title: 'Download failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const rows = query.data?.data || [];
  const filtersAppliedCount = [search.trim(), province.trim(), municipality.trim(), barangay.trim()].filter(
    Boolean,
  ).length;
  const canConfirmUpload =
    Boolean(selectedBulkFile) &&
    Boolean(bulkPreview?.templateValid) &&
    (bulkPreview?.validRows || 0) > 0 &&
    !bulkUploadResult &&
    !bulkPreviewMutation.isPending &&
    !bulkUploadMutation.isPending;
  const bulkPreviewRowsSorted = useMemo(
    () =>
      bulkPreview
        ? [...bulkPreview.rows].sort((a, b) => {
            if (a.valid === b.valid) return a.row - b.row;
            return a.valid ? 1 : -1;
          })
        : [],
    [bulkPreview],
  );
  const bulkPreviewTotalPages = Math.max(1, Math.ceil(bulkPreviewRowsSorted.length / bulkPreviewPageSize));
  const safeBulkPreviewPage = Math.min(bulkPreviewPage, bulkPreviewTotalPages);
  const bulkPreviewRowsPaginated = bulkPreviewRowsSorted.slice(
    (safeBulkPreviewPage - 1) * bulkPreviewPageSize,
    safeBulkPreviewPage * bulkPreviewPageSize,
  );

  const downloadBase64File = (base64: string, filename: string) => {
    const link = document.createElement('a');
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <input
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setSelectedBulkFile(file);
                setBulkPreview(null);
                setBulkUploadResult(null);
                bulkPreviewMutation.mutate(file);
              }
              event.currentTarget.value = '';
            }}
            ref={fileInputRef}
            type="file"
          />
	              <button
            className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-700"
            onClick={() => setShowBulkActions((prev) => !prev)}
            type="button"
          >
            Bulk Upload
          </button>
          <Link className="rounded bg-blue-600 px-3 py-2 text-sm text-white" to="/customers/new">
            Create Customer
          </Link>
        </div>
      </div>

      {showBulkActions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Bulk Upload Customers</h2>
                <p className="text-sm text-gray-600">
                  Download the template, fill it in, then upload CSV/XLS/XLSX.
                </p>
              </div>
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600"
		                onClick={() => {
		                  setSelectedBulkFile(null);
		                  setBulkPreview(null);
		                  setBulkUploadResult(null);
		                  setBulkPreviewPage(1);
		                  setShowBulkActions(false);
		                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
	              <div className="flex flex-wrap items-center gap-2">
	                <button
	                  className="rounded border border-gray-400 px-3 py-2 text-sm text-gray-700"
                  disabled={downloadTemplateMutation.isPending}
                  onClick={() => downloadTemplateMutation.mutate()}
                  type="button"
	                >
	                  {downloadTemplateMutation.isPending ? 'Preparing...' : 'Download Template'}
	                </button>
	                <button
	                  className="rounded border border-blue-600 px-3 py-2 text-sm text-blue-700"
	                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Choose File
                </button>
              </div>

              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="No file selected"
                readOnly
                value={selectedBulkFile?.name || ''}
              />

              {bulkPreviewMutation.isPending && (
                <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  Validating file format and rows...
                </div>
              )}

              {bulkPreview && (
                <div className="space-y-2 rounded border border-gray-200 p-3">
                  <div className="grid gap-2 text-sm md:grid-cols-4">
                    <div>Total rows: {bulkPreview.totalRows}</div>
                    <div>Valid rows: {bulkPreview.validRows}</div>
                    <div>Invalid rows: {bulkPreview.invalidRows}</div>
                    <div>
                      Template: {bulkPreview.templateValid ? 'Valid' : 'Invalid'}
                    </div>
                  </div>

                  {!bulkPreview.templateValid && bulkPreview.missingHeaders.length > 0 && (
                    <div className="text-sm text-red-600">
                      Missing columns: {bulkPreview.missingHeaders.join(', ')}
                    </div>
                  )}

	                  {bulkPreview.rows.length > 0 && (
	                    <div className="space-y-2">
	                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
	                        <div>
	                          Showing {bulkPreviewRowsPaginated.length} of {bulkPreview.rows.length} rows (invalid first)
	                        </div>
	                        <div className="flex items-center gap-2">
	                          <label htmlFor="bulk-preview-page-size">Rows/page</label>
	                          <select
	                            className="rounded border px-2 py-1 text-xs"
	                            id="bulk-preview-page-size"
	                            onChange={(event) => {
	                              setBulkPreviewPage(1);
	                              setBulkPreviewPageSize(Number(event.target.value));
	                            }}
	                            value={bulkPreviewPageSize}
	                          >
	                            <option value={50}>50</option>
	                            <option value={100}>100</option>
	                            <option value={200}>200</option>
	                          </select>
	                        </div>
	                      </div>
	                    <div className="max-h-72 overflow-auto rounded border" ref={bulkPreviewTableRef}>
	                      <table className="min-w-full text-xs">
	                        <thead className="bg-gray-100 text-left">
                          <tr>
                            <th className="px-2 py-1">Row</th>
                            <th className="px-2 py-1">Name</th>
                            <th className="px-2 py-1">Province</th>
                            <th className="px-2 py-1">City</th>
                            <th className="px-2 py-1">Barangay</th>
                            <th className="px-2 py-1">Status</th>
                            <th className="px-2 py-1">Errors</th>
                          </tr>
	                        </thead>
	                        <tbody>
	                          {bulkPreviewRowsPaginated.map((item) => (
	                            <tr className="border-t" key={item.row}>
                              <td className="px-2 py-1">{item.row}</td>
                              <td className="px-2 py-1">
                                {item.preview.lastName}, {item.preview.firstName}
                              </td>
                              <td className="px-2 py-1">{item.preview.province}</td>
                              <td className="px-2 py-1">{item.preview.city}</td>
                              <td className="px-2 py-1">{item.preview.barangay}</td>
                              <td className={`px-2 py-1 ${item.valid ? 'text-green-700' : 'text-red-700'}`}>
                                {item.valid ? 'VALID' : 'INVALID'}
                              </td>
                              <td className="px-2 py-1">{item.errors.join('; ') || '-'}</td>
                            </tr>
	                          ))}
	                        </tbody>
	                      </table>
	                    </div>
	                      <div className="flex items-center justify-between text-xs text-slate-600">
	                        <div>
	                          Page {safeBulkPreviewPage} of {bulkPreviewTotalPages}
	                        </div>
	                        <div className="flex gap-2">
	                          <button
	                            className="rounded border px-2 py-1 disabled:opacity-50"
	                            disabled={safeBulkPreviewPage <= 1}
	                            onClick={() => setBulkPreviewPage((prev) => Math.max(1, prev - 1))}
	                            type="button"
	                          >
	                            Previous
	                          </button>
	                          <button
	                            className="rounded border px-2 py-1 disabled:opacity-50"
	                            disabled={safeBulkPreviewPage >= bulkPreviewTotalPages}
	                            onClick={() => setBulkPreviewPage((prev) => Math.min(bulkPreviewTotalPages, prev + 1))}
	                            type="button"
	                          >
	                            Next
	                          </button>
	                        </div>
	                      </div>
	                    </div>
	                  )}
	                </div>
	              )}

	              {bulkUploadResult && (
	                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
	                  Uploaded successfully: {bulkUploadResult.created} row(s). Failed: {bulkUploadResult.failed} row(s).
	                </div>
	              )}

	              <div className="flex items-center justify-end gap-3">
	                {bulkUploadResult?.invalidReportBase64 && bulkUploadResult.invalidReportFilename ? (
	                  <button
	                    className="text-sm font-medium text-amber-700 underline underline-offset-2"
	                    onClick={() =>
	                      downloadBase64File(
	                        bulkUploadResult.invalidReportBase64 as string,
	                        bulkUploadResult.invalidReportFilename as string,
	                      )
	                    }
	                    type="button"
	                  >
	                    Download Upload Errors File
	                  </button>
	                ) : selectedBulkFile && bulkPreview ? (
	                  <button
	                    className="text-sm font-medium text-emerald-700 underline underline-offset-2 disabled:opacity-60"
	                    disabled={downloadValidatedFileMutation.isPending}
	                    onClick={() => {
	                      if (selectedBulkFile) {
	                        downloadValidatedFileMutation.mutate(selectedBulkFile);
	                      }
	                    }}
	                    type="button"
	                  >
	                    {downloadValidatedFileMutation.isPending
	                      ? 'Preparing Validated File...'
	                      : 'Download Validated File'}
	                  </button>
	                ) : null}
                <button
                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400 disabled:opacity-100"
                  disabled={!canConfirmUpload}
                  onClick={() => {
                    if (selectedBulkFile) {
                      bulkUploadMutation.mutate(selectedBulkFile);
                    }
                  }}
                  type="button"
                >
                  {bulkUploadMutation.isPending
                    ? 'Uploading...'
                    : bulkUploadResult
                      ? 'Uploaded'
                      : 'Confirm and Upload'}
                </button>
	              </div>
	            </div>
	          </div>
	        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <input
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            placeholder="Search name, contact, or facebook account"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <select
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            value={province}
            onChange={(event) => {
              setPage(1);
              setProvince(event.target.value);
            }}
          >
            <option value="">All provinces</option>
            {PROVINCES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            disabled={!province}
            value={municipality}
            onChange={(event) => {
              setPage(1);
              setMunicipality(event.target.value);
            }}
          >
            <option value="">
              {!province ? 'Select province first' : 'All municipalities'}
            </option>
            {municipalityOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            disabled={!municipality}
            value={barangay}
            onChange={(event) => {
              setPage(1);
              setBarangay(event.target.value);
            }}
          >
            <option value="">
              {!municipality
                ? 'Select municipality first'
                : barangayOptions.length > 0
                  ? 'All barangays'
                  : 'No barangay list available'}
            </option>
            {barangayOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-600">
            {filtersAppliedCount} {filtersAppliedCount === 1 ? 'filter' : 'filters'} applied
          </span>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setPage(1);
              setSearch('');
              setProvince('');
              setMunicipality('');
              setBarangay('');
            }}
            type="button"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-3">
                <button
                  className="font-medium text-slate-700"
                  onClick={() => {
                    setPage(1);
                    if (sortBy === 'lastName') {
                      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                    } else {
                      setSortBy('lastName');
                      setSortDir('asc');
                    }
                  }}
                  type="button"
                >
                  Customer {sortBy === 'lastName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  className="font-medium text-slate-700"
                  onClick={() => {
                    setPage(1);
                    if (sortBy === 'contactNumber') {
                      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                    } else {
                      setSortBy('contactNumber');
                      setSortDir('asc');
                    }
                  }}
                  type="button"
                >
                  Contact {sortBy === 'contactNumber' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  className="font-medium text-slate-700"
                  onClick={() => {
                    setPage(1);
                    if (sortBy === 'facebookAccountName') {
                      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                    } else {
                      setSortBy('facebookAccountName');
                      setSortDir('asc');
                    }
                  }}
                  type="button"
                >
                  Facebook {sortBy === 'facebookAccountName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-slate-200 hover:bg-gray-50"
                onClick={() => navigate(`/customers/${row.id}`)}
              >
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">
                    {[row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.barangay}, {row.city}
                  </p>
                </td>
                <td className="px-4 py-3">{row.contactNumber}</td>
                <td className="px-4 py-3">
                  {row.facebookAccountName ? (
                    row.facebookProfileLink ? (
                      <a
                        className="text-blue-600 hover:underline"
                        href={normalizeExternalUrl(row.facebookProfileLink)}
                        onClick={(event) => event.stopPropagation()}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {row.facebookAccountName}
                      </a>
                    ) : (
                      row.facebookAccountName
                    )
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Link
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      onClick={(event) => event.stopPropagation()}
                      to={`/customers/${row.id}/edit`}
                    >
                      Edit
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                  {query.isLoading ? 'Loading...' : 'No records'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          Page {query.data?.page || 1} of {query.data?.totalPages || 1}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600" htmlFor="rows-per-page">
            Rows per page
          </label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            id="rows-per-page"
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value));
            }}
            value={pageSize}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            disabled={Boolean(query.data && page >= query.data.totalPages)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
