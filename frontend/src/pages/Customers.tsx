import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Button, Card, Empty, Field, Input } from '../components/ui';
import { can, useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, usd } from '../lib/format';

const empty = { firstName: '', lastName: '', phone: '', email: '', address: '', insuranceProvider: '', allergies: '' };

export function Customers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['customers', search],
    queryFn: async () => (await api.get('/api/customers', { params: { search, pageSize: 50 } })).data as {
      items: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; insuranceProvider: string | null; _count: { sales: number } }[];
      total: number;
    },
  });

  const save = useMutation({
    mutationFn: async () => (await api.post('/api/customers', form)).data,
    onSuccess: () => { setShow(false); setForm(empty); setMsg('Customer saved.'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/customers/${id}`)).data,
    onSuccess: () => { setMsg('Customer deleted.'); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => setMsg(apiError(e)),
  });
  const canDelete = can(user, 'ADMIN', 'PHARMACIST');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Customers</h1><p className="text-sm opacity-60">{data?.total ?? 0} profiles · insurance + allergy notes</p></div>
        <Button onClick={() => setShow(true)}><Plus size={16} /> Add customer</Button>
      </div>
      <Card className="no-print"><Input placeholder="Search name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" /></Card>
      {msg && <p className="text-sm" role="status">{msg}</p>}
      {show && (
        <Card>
          <h2 className="mb-3 font-bold">New customer</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="First name *"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name *"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) …" /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Insurance"><Input value={form.insuranceProvider} onChange={(e) => setForm({ ...form, insuranceProvider: e.target.value })} /></Field>
            <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Allergies / notes"><Input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button></div>
        </Card>
      )}
      {(data?.items ?? []).length === 0 ? <Empty title="No customers" /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th></th><th>Name</th><th>Phone</th><th>Email</th><th>Insurance</th><th>Sales</th>{canDelete && <th className="no-print">Action</th>}</tr></thead>
          <tbody>{(data?.items ?? []).map((c) => (
            <>
              <tr key={c.id}>
                <td><button aria-label={`History for ${c.firstName} ${c.lastName}`} className="rounded-lg border p-1.5" style={{ borderColor: 'hsl(var(--border))' }} onClick={() => setOpenId(openId === c.id ? null : c.id)}><ChevronDown size={14} /></button></td>
                <td className="font-semibold">{c.firstName} {c.lastName}</td><td>{c.phone ?? '—'}</td><td>{c.email ?? '—'}</td><td>{c.insuranceProvider ?? '—'}</td><td>{c._count.sales}</td>
                {canDelete && (
                  <td className="no-print">
                    <button className="rounded-lg border p-1.5 text-red-600" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`Delete ${c.firstName} ${c.lastName}`} title="Delete (blocked if sales history exists)" onClick={() => { if (confirm(`Delete ${c.firstName} ${c.lastName}? Blocked if they have sales history.`)) remove.mutate(c.id); }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
              {openId === c.id && (
                <tr key={`${c.id}-history`}>
                  <td colSpan={canDelete ? 7 : 6} style={{ background: 'hsl(var(--muted) / 0.5)' }}><CustomerHistory id={c.id} /></td>
                </tr>
              )}
            </>
          ))}</tbody>
        </table></div>
      )}
      <p className="text-xs opacity-50">PHI note: collect only what you need (minimum-necessary) and never paste full clinical notes here. {fmtDate(new Date().toISOString())}</p>
    </div>
  );
}

function CustomerHistory({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await api.get(`/api/customers/${id}`)).data as {
      customer: {
        allergies: string | null; insuranceProvider: string | null; address: string | null;
        sales: { id: string; invoiceNo: string; total: number; status: string; createdAt: string }[];
      };
    },
  });
  if (isLoading) return <p className="p-2 text-sm opacity-60">Loading history…</p>;
  const c = data?.customer;
  if (!c) return <p className="p-2 text-sm opacity-60">Not found.</p>;
  return (
    <div className="p-2 text-sm">
      <p className="opacity-80">
        <strong>Allergies:</strong> {c.allergies || 'none recorded'} · <strong>Insurance:</strong> {c.insuranceProvider || '—'} · <strong>Address:</strong> {c.address || '—'}
      </p>
      {c.sales.length === 0 ? <p className="mt-1 opacity-60">No purchases yet.</p> : (
        <ul className="mt-2 space-y-1">
          {c.sales.map((s) => (
            <li key={s.id} className="flex justify-between gap-3">
              <span className="font-mono text-xs">{s.invoiceNo} · {fmtDateTime(s.createdAt)} · {s.status}</span>
              <span className="font-bold">{usd(s.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
