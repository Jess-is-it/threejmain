import { useQuery } from '@tanstack/react-query';
import { api, fetchJson } from '../common/http';

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}

export default function ApiPage() {
  const query = useQuery({
    queryKey: ['openapi'],
    queryFn: () => fetchJson<OpenApiDoc>(api.docsJson),
  });

  const endpoints: Array<{ method: string; path: string }> = [];
  for (const [path, methods] of Object.entries(query.data?.paths || {})) {
    for (const method of Object.keys(methods)) {
      endpoints.push({ method: method.toUpperCase(), path });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">API Page</h1>
      <div className="rounded border bg-white p-3">
        <iframe className="h-[480px] w-full" src={api.docs} title="Swagger UI" />
      </div>

      <div className="overflow-auto rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Path</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((item) => (
              <tr className="border-t" key={`${item.method}-${item.path}`}>
                <td className="px-3 py-2">{item.method}</td>
                <td className="px-3 py-2">{item.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
