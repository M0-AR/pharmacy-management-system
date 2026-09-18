import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, DollarSign, Pill, Receipt, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, Empty } from '../components/ui';
import { fmtDate, usd } from '../lib/format';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

interface Summary {
  totals: {
    medicines: number; customers: number; suppliers: number; lowStock: number;
    outOfStock: number; expired: number; totalSales: number; revenue: number;
    todaySales: number; todayRevenue: number; inventoryValue: number;
  };
  salesByDay: { date: string; revenue: number }[];
  topSellers: { medicineId: string; name: string; code: string; qty: number; revenue: number }[];
  stockByCategory: { category: string; count: number }[];
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['summary'],
    queryFn: async () => (await api.get('/api/reports/summary')).data as Summary,
  });

  if (isLoading) return <p className="opacity-60">Loading dashboard…</p>;
  if (error || !data) return <Empty title="Could not load dashboard" hint="Is the API running? Check docker compose logs." />;
  const t = data.totals;

  const kpis = [
    { icon: DollarSign, label: 'Revenue (all time)', value: usd(t.revenue), sub: `${t.totalSales} sales · ${usd(t.todayRevenue)} today` },
    { icon: Receipt, label: "Today's sales", value: String(t.todaySales), sub: `${usd(t.todayRevenue)} collected today` },
    { icon: Pill, label: 'Medicines', value: String(t.medicines), sub: `${usd(t.inventoryValue)} inventory value` },
    { icon: AlertTriangle, label: 'Needs attention', value: String(t.lowStock + t.expired + t.outOfStock), sub: `${t.lowStock} low · ${t.outOfStock} out · ${t.expired} expired` },
    { icon: Users, label: 'Customers', value: String(t.customers), sub: `${t.suppliers} suppliers` },
    { icon: Boxes, label: 'Stock health', value: t.outOfStock === 0 ? 'Good' : 'Action needed', sub: 'Expiry-checked at POS' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Command center</h1>
          <p className="text-sm opacity-60">Everything a US community pharmacy needs — one screen, keyboard friendly.</p>
        </div>
        <div className="no-print flex gap-2">
          <Link to="/pos" className="btn btn-primary">New sale</Link>
          <Link to="/medicines" className="btn btn-ghost">Add medicine</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label} className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#0d9488,#2563eb)' }}>
              <k.icon size={20} />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wider opacity-60">{k.label}</span>
              <span className="block text-2xl font-extrabold">{k.value}</span>
              <span className="block text-xs opacity-60">{k.sub}</span>
            </span>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Revenue — last 14 days (USD)</h2>
            <Badge tone="blue">live</Badge>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.salesByDay}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [usd(Number(v)), 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="#0d9488" fill="#0d9488" fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">Top sellers</h2>
          <div className="space-y-3">
            {data.topSellers.length === 0 && <p className="text-sm opacity-60">No sales yet — run your first POS sale.</p>}
            {data.topSellers.map((s) => (
              <div key={s.medicineId} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="text-xs opacity-60">{s.code} · {s.qty} units</p>
                </div>
                <span className="font-bold">{usd(s.revenue)}</span>
              </div>
            ))}
          </div>
          <h2 className="mb-2 mt-6 font-bold">Stock by category</h2>
          <div className="flex flex-wrap gap-2">
            {data.stockByCategory.map((c) => (
              <span key={c.category} className="badge badge-gray">{c.category} · {c.count}</span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Low-stock watchlist</h2>
          <Link to="/inventory" className="text-sm font-semibold text-teal-700 dark:text-teal-300">Open inventory →</Link>
        </div>
        <LowStockPreview />
      </Card>
    </div>
  );
}

function LowStockPreview() {
  const { data } = useQuery({
    queryKey: ['low-preview'],
    queryFn: async () => (await api.get('/api/medicines/low-stock')).data as { items: { id: string; name: string; code: string; quantity: number; lowStockThreshold: number; expiryDate: string | null }[] },
  });
  const items = (data?.items ?? []).slice(0, 5);
  if (items.length === 0) return <p className="text-sm opacity-60">All stocked up. Nice work.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>Code</th><th>Medicine</th><th>Qty</th><th>Expiry</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td className="font-mono text-xs">{m.code}</td>
              <td className="font-semibold">{m.name}</td>
              <td>{m.quantity}</td>
              <td>{fmtDate(m.expiryDate)}</td>
              <td><Badge tone={m.quantity === 0 ? 'red' : 'amber'}>{m.quantity === 0 ? 'Out of stock' : 'Low stock'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
