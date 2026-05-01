import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api, fetchJson } from '../common/http';

interface OverviewResponse {
  totalCustomers: number;
  enrileCustomers: number;
  newCustomersThisMonth: number;
  averageNewCustomersLast6Months: number;
  trendDirection: 'UP' | 'DOWN' | 'FLAT';
  trendDelta: number;
  monthlyGrowthTrend: Array<{ month: string; newCount: number; cumulativeTotal: number }>;
  municipalities: Array<{ city: string; count: number }>;
  topBarangays: Array<{ barangay: string; count: number }>;
}

export default function DashboardPage() {
  const overview = useQuery({
    queryKey: ['customers-overview'],
    queryFn: () => fetchJson<OverviewResponse>(api.customersOverview),
  });

  const data = overview.data;
  const topMunicipalities = data?.municipalities.slice(0, 10) || [];
  const topBarangays = data?.topBarangays.slice(0, 10) || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Customer Overview</h1>
        <p className="text-sm text-gray-600">Live KPIs and trend analytics.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          label="Total Customers"
          value={data?.totalCustomers}
          loading={overview.isLoading}
          tone="blue"
        />
        <KpiCard
          label="New Customers (This Month)"
          value={data?.newCustomersThisMonth}
          loading={overview.isLoading}
          tone="green"
        />
        <KpiCard
          label="Avg New / Month (Last 6 Months)"
          value={data?.averageNewCustomersLast6Months}
          loading={overview.isLoading}
          tone="amber"
          subtext={
            data
              ? `Trend: ${data.trendDirection} (${data.trendDelta >= 0 ? '+' : ''}${data.trendDelta}) vs previous month`
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border bg-white p-4 xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Monthly Growth Trend</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={data?.monthlyGrowthTrend || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  dataKey="newCount"
                  name="New Customers"
                  stroke="#1D4ED8"
                  strokeWidth={3}
                  type="monotone"
                />
                <Line
                  dataKey="cumulativeTotal"
                  name="Cumulative Total"
                  stroke="#10B981"
                  strokeWidth={3}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Top Barangay</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={topBarangays}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="barangay" interval={0} angle={-25} textAnchor="end" height={85} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Customers by Municipality</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={topMunicipalities}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="city" interval={0} angle={-25} textAnchor="end" height={85} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  loading,
  subtext,
  tone = 'blue',
}: {
  label: string;
  value: string | number | undefined;
  loading?: boolean;
  subtext?: string;
  tone?: 'blue' | 'green' | 'amber';
}) {
  const tones: Record<'blue' | 'green' | 'amber', string> = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
  };

  return (
    <div className={`rounded border p-4 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-800">
        {loading ? '...' : value ?? '-'}
      </div>
      {subtext && <div className="mt-1 text-xs text-gray-600">{subtext}</div>}
    </div>
  );
}
