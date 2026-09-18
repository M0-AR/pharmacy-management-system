import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, RotateCcw } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, Field, Input, Select } from '../components/ui';
import { can, useAuth } from '../lib/auth';
import { useStoreSettings } from '../lib/store';
import { fmtDateTime, usd } from '../lib/format';

interface SaleDetail {
  id: string; invoiceNo: string; status: string; paymentMethod: string; createdAt: string;
  subtotal: number; discountPct: number; discountAmt: number; taxPct: number; taxAmt: number; total: number;
  customer: { id: string; firstName: string; lastName: string; phone: string | null; address: string | null } | null;
  soldBy: { name: string } | null;
  items: { id: string; qty: number; unitPrice: number; lineTotal: number; medicineId: string; medicine: { code: string; name: string } }[];
  returns: { medicineId: string; qty: number }[];
  refundedTotal: number;
}

export function Invoice() {
  const { id } = useParams();
  const { user } = useAuth();
  const store = useStoreSettings();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [retMed, setRetMed] = useState('');
  const [retQty, setRetQty] = useState('1');
  const [retReason, setRetReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => (await api.get(`/api/sales/${id}`)).data as { sale: SaleDetail },
  });

  const voidSale = useMutation({
    mutationFn: async () => (await api.post(`/api/sales/${id}/void`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sale', id] }); qc.invalidateQueries({ queryKey: ['sales'] }); setMsg('Sale voided and stock restored.'); },
    onError: (e) => setMsg(apiError(e)),
  });

  const doReturn = useMutation({
    mutationFn: async () => (await api.post(`/api/sales/${id}/returns`, {
      items: [{ medicineId: retMed, qty: Number(retQty) }],
      reason: retReason,
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale', id] }); qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['medicines'] }); qc.invalidateQueries({ queryKey: ['summary'] });
      setRetMed(''); setRetQty('1'); setRetReason(''); setMsg('Return recorded — stock restored and ledgered.');
    },
    onError: (e) => setMsg(apiError(e)),
  });

  if (isLoading) return <p className="opacity-60">Loading invoice…</p>;
  if (!data) return <Empty title="Invoice not found" />;
  const s = data.sale;
  const returnedById = new Map(s.returns.map((r) => [r.medicineId, r.qty]));
  const returnable = s.items
    .map((i) => ({ ...i, returned: returnedById.get(i.medicineId) ?? 0 }))
    .filter((i) => i.qty - i.returned > 0);
  const canManage = can(user, 'ADMIN', 'PHARMACIST') && s.status !== 'VOIDED';

  const refill = () => {
    sessionStorage.setItem('pharma_refill', JSON.stringify({
      customerId: s.customer ? (s.customer as { id: string }).id : undefined,
      items: s.items.map((i) => ({ medicineId: i.medicineId, qty: i.qty })),
    }));
    nav('/pos');
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">Invoice {s.invoiceNo}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={refill}><RotateCcw size={16} /> Refill from this invoice</Button>
          <Button variant="ghost" onClick={() => window.print()}><Printer size={16} /> Print / PDF</Button>
          {canManage && (
            <Button variant="danger" disabled={voidSale.isPending} onClick={() => { if (confirm('Void this entire sale? All stock will be restored.')) voidSale.mutate(); }}>Void sale</Button>
          )}
        </div>
      </div>
      {msg && <p className="no-print text-sm" role="status">{msg}</p>}

      <Card className="print-area">
        <div className="flex flex-wrap justify-between gap-4 border-b pb-4" style={{ borderColor: 'hsl(var(--border))' }}>
          <div>
            <p className="text-xl font-extrabold">{store['store.name']}</p>
            <p className="text-sm opacity-60">{store['store.tagline']} · {store['store.address']} · {store['store.phone']}</p>
            <p className="text-sm opacity-60">Questions? Keep this receipt for returns & insurance.</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-mono font-bold">{s.invoiceNo}</p>
            <p className="opacity-60">{fmtDateTime(s.createdAt)}</p>
            <p className="mt-1"><Badge tone={s.status === 'VOIDED' ? 'red' : 'green'}>{s.status}</Badge> <Badge tone="blue">{s.paymentMethod}</Badge></p>
          </div>
        </div>
        <div className="grid gap-4 py-4 text-sm sm:grid-cols-2">
          <div><p className="text-xs font-bold uppercase opacity-60">Billed to</p><p className="font-semibold">{s.customer ? `${s.customer.firstName} ${s.customer.lastName}` : 'Walk-in customer'}</p><p className="opacity-60">{s.customer?.phone ?? ''} {s.customer?.address ?? ''}</p></div>
          <div className="sm:text-right"><p className="text-xs font-bold uppercase opacity-60">Served by</p><p className="font-semibold">{s.soldBy?.name ?? '—'}</p></div>
        </div>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Item</th><th>Qty</th><th>Returned</th><th>Unit</th><th className="text-right">Line total</th></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.id}><td><p className="font-semibold">{i.medicine.name}</p><p className="font-mono text-xs opacity-60">{i.medicine.code}</p></td><td>{i.qty}</td><td>{returnedById.get(i.medicineId) ?? 0}</td><td>{usd(i.unitPrice)}</td><td className="text-right font-semibold">{usd(i.lineTotal)}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span>{usd(s.subtotal)}</span></p>
          <p className="flex justify-between"><span>Discount ({s.discountPct}%)</span><span>−{usd(s.discountAmt)}</span></p>
          <p className="flex justify-between"><span>Sales tax ({s.taxPct}%)</span><span>+{usd(s.taxAmt)}</span></p>
          <p className="flex justify-between border-t pt-2 text-lg font-extrabold" style={{ borderColor: 'hsl(var(--border))' }}><span>Total (USD)</span><span>{usd(s.total)}</span></p>
          {s.refundedTotal > 0 && <p className="flex justify-between font-semibold text-teal-700 dark:text-teal-300"><span>Refunded</span><span>−{usd(s.refundedTotal)}</span></p>}
        </div>
        <p className="mt-6 text-center text-xs opacity-60">{store['store.receiptFooter']}</p>
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-1 font-bold">Record a return</h2>
          <p className="mb-3 text-sm opacity-60">Partial returns restock instantly with a RETURN ledger entry. Cannot return more than was sold.</p>
          {returnable.length === 0 ? <p className="text-sm opacity-60">Everything on this invoice was already returned.</p> : (
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Item">
                <Select value={retMed} onChange={(e) => setRetMed(e.target.value)}>
                  <option value="">Select…</option>
                  {returnable.map((i) => <option key={i.medicineId} value={i.medicineId}>{i.medicine.name} ({i.qty - i.returned} returnable)</option>)}
                </Select>
              </Field>
              <Field label="Qty"><Input type="number" min="1" value={retQty} onChange={(e) => setRetQty(e.target.value)} /></Field>
              <Field label="Reason *"><Input value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder="Unopened, patient request…" /></Field>
              <div className="flex items-end"><Button disabled={!retMed || doReturn.isPending || retReason.trim().length < 3} onClick={() => doReturn.mutate()}>Record return</Button></div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
