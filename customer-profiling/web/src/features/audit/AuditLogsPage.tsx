import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fetchJson, ListResponse } from '../common/http';
import { AuditLog } from '../customers/types';

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: 'timestamp',
      sortDir: 'desc',
    });
    if (search.trim()) {
      params.set('search', search.trim());
    }
    return params.toString();
  }, [page, pageSize, search]);

  const query = useQuery({
    queryKey: ['audit-logs', queryString],
    queryFn: () => fetchJson<ListResponse<AuditLog>>(`${api.auditLogs}?${queryString}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Logs</h1>
      <input
        className="w-full max-w-md rounded border px-3 py-2"
        placeholder="Search actor, action, entity"
        value={search}
        onChange={(event) => {
          setPage(1);
          setSearch(event.target.value);
        }}
      />
      <div className="overflow-auto rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Correlation ID</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.data || []).map((item) => (
              <tr className="border-t" key={item.id}>
                <td className="px-3 py-2">{new Date(item.timestamp).toLocaleString()}</td>
                <td className="px-3 py-2">{item.actionType}</td>
                <td className="px-3 py-2">{item.entityType}</td>
                <td className="px-3 py-2">{item.actorUsername || item.actorUserId}</td>
                <td className="px-3 py-2">{item.correlationId || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Page {query.data?.page || 1} of {query.data?.totalPages || 1}
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border px-3 py-1"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            className="rounded border px-3 py-1"
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
