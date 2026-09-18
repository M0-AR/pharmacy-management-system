import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, Empty } from '../components/ui';
import { usd } from '../lib/format';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['#0d9488', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

export function Reports() {
  const { data, isLoading } = useQuery({
    queryKey: ['summary'],
    queryFn: async () => (await api.get('/api/reports/summary')).data as {
      totals: Record<string, number>;
      topSellers: { name: string; qty: number; revenue: number }[];
      stockByCategory: { category: string; count: number }[];
      salesByDay: { date: string; revenue: number }[];
    },
  });
  if (isLoading) return <p className="opacity-60">Loading reports…</p>;
  if (!data) return <Empty title="No report data" />;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Reports</h1>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Total medicines', t.medicines], ['Available (in stock)', (t.medicines ?? 0) - (t.outOfStock ?? 0)], ['Low stock', t.lowStock], ['Expired', t.expired], ['Customers', t.customers], ['Sales', t.totalSales], ['Revenue (USD)', usd(t.revenue)], ['Inventory value', usd(t.inventoryValue)]].map(([k, v]) => (
          <Card key={k as string}><p className="text-xs font-semibold uppercase opacity-60">{k}</p><p className="text-2xl font-extrabold">{String(v)}</p></Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold">Top sellers by units</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topSellers}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} dy={10} height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="qty" fill="#0d9488" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Catalog mix by category</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.stockByCategory} dataKey="count" nameKey="category" outerRadius={90} label>
                  {data.stockByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
