import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Button, Card, Empty, Field, Input } from '../components/ui';
import { can, useAuth } from '../lib/auth';

const empty = { name: '', contactName: '', phone: '', email: '', address: '' };

interface Supplier {
  id: string; name: string; contactName: string | null; phone: string | null;
  email: string | null; address: string | null; _count: { medicines: number };
}

export function Suppliers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState('');

  const { data } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: async () => (await api.get('/api/suppliers', { params: {} })).data as { items: Supplier[] },
  });
  const items = (data?.items ?? []).filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  const save = useMutation({
    mutationFn: async () => editing
      ? (await api.put(`/api/suppliers/${editing.id}`, form)).data
      : (await api.post('/api/suppliers', form)).data,
    onSuccess: () => { setShow(false); setEditing(null); setForm(empty); setMsg(editing ? 'Supplier updated.' : 'Supplier added.'); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['suppliers-mini'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/suppliers/${id}`)).data,
    onSuccess: () => { setMsg('Supplier deleted — linked medicines kept with no supplier.'); qc.invalidateQueries({ queryKey: ['suppliers'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const canWrite = can(user, 'ADMIN', 'PHARMACIST');
  const canDelete = can(user, 'ADMIN');
  const openAdd = () => { setEditing(null); setForm(empty); setShow(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ name: s.name, contactName: s.contactName ?? '', phone: s.phone ?? '', email: s.email ?? '', address: s.address ?? '' });
    setShow(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Suppliers</h1><p className="text-sm opacity-60">Wholesalers linked to medicines for reorders</p></div>
        {canWrite && <Button onClick={openAdd}><Plus size={16} /> Add supplier</Button>}
      </div>
      <Card className="no-print"><Input placeholder="Filter suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter suppliers" /></Card>
      {msg && <p className="text-sm" role="status">{msg}</p>}
      {show && canWrite && (
        <Card>
          <h2 className="mb-3 font-bold">{editing ? 'Edit supplier' : 'New supplier'}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Company *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Contact"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? 'Update' : 'Save'}</Button><Button variant="ghost" onClick={() => { setShow(false); setEditing(null); }}>Cancel</Button></div>
        </Card>
      )}
      {items.length === 0 ? <Empty title="No suppliers" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{s.name}</p>
                  <p className="text-sm opacity-60">{[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact on file'}</p>
                  <p className="mt-2 text-xs font-semibold opacity-70">{s._count.medicines} linked medicines</p>
                </div>
                {(canWrite || canDelete) && (
                  <div className="flex gap-1">
                    {canWrite && <button className="rounded-lg border p-2" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)}><Pencil size={15} /></button>}
                    {canDelete && <button className="rounded-lg border p-2 text-red-600" style={{ borderColor: 'hsl(var(--border))' }} aria-label={`Delete ${s.name}`} onClick={() => { if (confirm(`Delete ${s.name}? Linked medicines will be kept with no supplier.`)) remove.mutate(s.id); }}><Trash2 size={15} /></button>}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
