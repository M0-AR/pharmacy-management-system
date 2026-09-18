import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, Empty } from '../components/ui';
import { downloadCsv } from '../lib/store';
import { fmtDateTime, usd } from '../lib/format';

interface SaleRow { id: string; invoiceNo: string; total: number; status: string; paymentMethod: string; createdAt: string; customer: { firstName: string; lastName: string } | null; soldBy: { name: string } | null; _count: { items: number } }

export function Sales() {
  const { data, isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => (await api.get('/api/sales', { params: { pageSize: 30 } })).data as { items: SaleRow[]; total: number },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div><h1 className="text-2xl font-extrabold">Sales & invoices</h1><p className="text-sm opacity-60">{data?.total ?? 0} transactions · void restocks automatically</p></div>
        <div className="no-print flex gap-2">
          <Button
            variant="ghost"
            aria-label="Export sales as CSV"
            title="Export sales as CSV"
            onClick={() => downloadCsv(`sales-${new Date().toISOString().slice(0, 10)}.csv`, (data?.items ?? []).map((s) => ({
              invoiceNo: s.invoiceNo, date: s.createdAt, customer: s.customer ? `${s.customer.firstName} ${s.customer.lastName}` : 'Walk-in',
              lines: s._count.items, payment: s.paymentMethod, totalUSD: s.total, status: s.status,
            })))}
          >
            <Download size={16} />
          </Button>
          <Link to="/pos" className="btn btn-primary no-print">New sale</Link>
        </div>
      </div>
      {isLoading ? <p className="opacity-60">Loading…</p> : (data?.items ?? []).length === 0 ? <Empty title="No sales yet" hint="Create your first sale in the POS." /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Invoice</th><th>When</th><th>Customer</th><th>Lines</th><th>Pay</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{(data?.items ?? []).map((s) => (
            <tr key={s.id}>
              <td><Link to={`/sales/${s.id}`} className="font-mono text-xs font-bold text-teal-700 dark:text-teal-300">{s.invoiceNo}</Link></td>
              <td>{fmtDateTime(s.createdAt)}</td>
              <td>{s.customer ? `${s.customer.firstName} ${s.customer.lastName}` : 'Walk-in'}</td>
              <td>{s._count.items}</td>
              <td>{s.paymentMethod}</td>
              <td className="font-bold">{usd(s.total)}</td>
              <td><Badge tone={s.status === 'VOIDED' ? 'red' : 'green'}>{s.status}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
