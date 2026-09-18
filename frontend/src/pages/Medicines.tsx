import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, Field, Input, Select } from '../components/ui';
import { can, useAuth } from '../lib/auth';
import { downloadCsv } from '../lib/store';
import { fmtDate, fmtDateTime, isExpired, usd } from '../lib/format';

interface Medicine {
  id: string; code: string; name: string; genericName: string | null; brand: string | null;
  category: string; ndc: string | null; rxType: 'RX' | 'OTC'; unitPrice: number;
  quantity: number; lowStockThreshold: number; expiryDate: string | null;
  supplier?: { id: string; name: string } | null;
}

const emptyForm = { name: '', genericName: '', brand: '', category: 'Tablets', ndc: '', rxType: 'OTC', unitPrice: '5.49', quantity: '50', lowStockThreshold: '10', expiryDate: '', supplierId: '' };

export function Medicines() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stock, setStock] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['medicines', search, category, stock],
    queryFn: async () => (await api.get('/api/medicines', { params: { search, category, stock, pageSize: 50 } })).data as { items: Medicine[]; total: number; categories: string[] },
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['medicines'] }); qc.invalidateQueries({ queryKey: ['summary'] }); qc.invalidateQueries({ queryKey: ['low-preview'] }); };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        unitPrice: Number(form.unitPrice),
        quantity: Number(form.quantity),
        lowStockThreshold: Number(form.lowStockThreshold),
        supplierId: form.supplierId || null,
        expiryDate: form.expiryDate || null,
      };
      if (editing) return (await api.put(`/api/medicines/${editing.id}`, payload)).data;
      return (await api.post('/api/medicines', payload)).data;
    },
    onSuccess: () => { setShowForm(false); setEditing(null); setForm(emptyForm); setMsg('Saved.'); invalidate(); },
    onError: (e) => setMsg(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/medicines/${id}`)).data,
    onSuccess: () => { setMsg('Deleted.'); invalidate(); },
    onError: (e) => setMsg(apiError(e)),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-mini'],
    queryFn: async () => (await api.get('/api/suppliers')).data as { items: { id: string; name: string }[] },
  });

  const canWrite = can(user, 'ADMIN', 'PHARMACIST', 'TECHNICIAN');
  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Medicines</h1>
          <p className="text-sm opacity-60">{data?.total ?? 0} products · USD · NDC + Rx/OTC + expiry tracked</p>
        </div>
        {canWrite && (
          <Button onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(true); }}>
            <Plus size={16} /> Add medicine
          </Button>
        )}
      </div>
      {historyId && <MovementsDrawer medicineId={historyId} onClose={() => setHistoryId(null)} />}

      <Card className="no-print">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute left-3 top-3 opacity-50" />
            <Input className="pl-9" placeholder="Search name, generic, brand, code, NDC…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search medicines" />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="flex gap-2">
            <Select value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Stock filter" className="flex-1">
              <option value="all">All stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="expired">Expired</option>
            </Select>
            <Button
              variant="ghost"
              title="Export current view as CSV"
              aria-label="Export current view as CSV"
              onClick={() => downloadCsv(`medicines-${stock}-${new Date().toISOString().slice(0, 10)}.csv`, items.map((m) => ({
                code: m.code, name: m.name, generic: m.genericName ?? '', brand: m.brand ?? '', category: m.category,
                ndc: m.ndc ?? '', rxType: m.rxType, unitPriceUSD: m.unitPrice, quantity: m.quantity,
                lowStockThreshold: m.lowStockThreshold, expiryDate: m.expiryDate ?? '', supplier: m.supplier?.name ?? '',
              })))}
            >
              <Download size={16} />
            </Button>
          </div>
        </div>
      </Card>

      {msg && <p className="text-sm opacity-80" role="status">{msg}</p>}

      {showForm && (
        <Card>
          <h2 className="mb-4 font-bold">{editing ? 'Update medicine' : 'Add medicine'}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Generic"><Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></Field>
            <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
            <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
            <Field label="NDC"><Input value={form.ndc} onChange={(e) => setForm({ ...form, ndc: e.target.value })} placeholder="e.g. 50580-0449" /></Field>
            <Field label="Rx type">
              <Select value={form.rxType} onChange={(e) => setForm({ ...form, rxType: e.target.value })}>
                <option value="OTC">OTC</option><option value="RX">RX (prescription)</option>
              </Select>
            </Field>
            <Field label="Unit price (USD) *"><Input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} /></Field>
            <Field label={editing ? 'Quantity (sets exact level)' : 'Opening quantity'}><Input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Low-stock threshold"><Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} /></Field>
            <Field label="Expiry date"><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></Field>
            <Field label="Supplier">
              <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">— none —</option>
                {(suppliers?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Update' : 'Add medicine'}</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {isLoading ? <p className="opacity-60">Loading…</p> : items.length === 0 ? <Empty title="No medicines found" hint="Add your first product to start selling." /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Code</th><th>Medicine</th><th>Cat.</th><th>Type</th><th>Price</th><th>Qty</th><th>Expiry</th><th>Status</th>{canWrite && <th className="no-print">Actions</th>}</tr></thead>
            <tbody>
              {items.map((m) => {
                const expired = isExpired(m.expiryDate);
                const low = m.quantity <= m.lowStockThreshold;
                return (
                  <tr key={m.id}>
                    <td className="font-mono text-xs">{m.code}</td>
                    <td>
                      <p className="font-semibold">{m.name}</p>
                      <p className="text-xs opacity-60">{[m.genericName, m.brand, m.ndc ? `NDC ${m.ndc}` : ''].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td>{m.category}</td>
                    <td><Badge tone={m.rxType === 'RX' ? 'blue' : 'gray'}>{m.rxType}</Badge></td>
                    <td className="font-semibold">{usd(m.unitPrice)}</td>
                    <td>{m.quantity}</td>
                    <td>{fmtDate(m.expiryDate)}</td>
                    <td>
                      <div className="flex gap-1">
                        {expired ? <Badge tone="red">Expired</Badge> : m.quantity === 0 ? <Badge tone="red">Out</Badge> : low ? <Badge tone="amber">Low</Badge> : <Badge tone="green">OK</Badge>}
                      </div>
                    </td>
                    {canWrite && (
                      <td className="no-print">
                        <div className="flex gap-1">
                          <button className="rounded-lg border p-2" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`History of ${m.name}`} title="Stock ledger" onClick={() => setHistoryId(m.id)}><History size={15} /></button>
                          <button className="rounded-lg border p-2" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`Edit ${m.name}`} onClick={() => {
                            setEditing(m);
                            setForm({ name: m.name, genericName: m.genericName ?? '', brand: m.brand ?? '', category: m.category, ndc: m.ndc ?? '', rxType: m.rxType, unitPrice: String(m.unitPrice), quantity: String(m.quantity), lowStockThreshold: String(m.lowStockThreshold), expiryDate: m.expiryDate ? m.expiryDate.slice(0, 10) : '', supplierId: m.supplier?.id ?? '' });
                            setShowForm(true);
                          }}><Pencil size={15} /></button>
                          <button className="rounded-lg border p-2 text-red-600" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`Delete ${m.name}`} onClick={() => { if (confirm(`Delete ${m.name}? Blocked if it has sales history.`)) remove.mutate(m.id); }}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MovementsDrawer({ medicineId, onClose }: { medicineId: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['movements', medicineId],
    queryFn: async () => (await api.get(`/api/medicines/${medicineId}/movements`)).data as {
      items: { id: string; changeQty: number; reason: string; note: string | null; refId: string | null; createdAt: string; createdBy: { name: string } | null }[];
    },
  });
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Stock ledger">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md overflow-auto p-5 shadow-2xl" style={{ background: 'hsl(var(--card))' }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Stock ledger (audit trail)</h2>
          <button className="rounded-lg border p-2" style={{ borderColor: 'hsl(var(--border))' }} onClick={onClose} aria-label="Close ledger"><X size={16} /></button>
        </div>
        <p className="mb-3 text-xs opacity-60">Every unit in or out — sales, purchases, corrections, returns — with who and why. Append-only.</p>
        <div className="space-y-2">
          {(data?.items ?? []).map((mv) => (
            <div key={mv.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: 'hsl(var(--border))' }}>
              <p className="flex items-center justify-between">
                <Badge tone={mv.changeQty >= 0 ? 'green' : 'red'}>{mv.changeQty >= 0 ? `+${mv.changeQty}` : mv.changeQty}</Badge>
                <span className="font-mono text-xs opacity-60">{mv.reason}</span>
              </p>
              {mv.note && <p className="mt-1 opacity-80">{mv.note}</p>}
              <p className="mt-1 text-xs opacity-60">{fmtDateTime(mv.createdAt)} · {mv.createdBy?.name ?? 'system'}</p>
            </div>
          ))}
          {(data?.items ?? []).length === 0 && <p className="text-sm opacity-60">No movements yet.</p>}
        </div>
      </div>
    </div>
  );
}
