import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, Field, Input, Select } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

export function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'CASHIER' });
  const [msg, setMsg] = useState('');

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data as {
      users: { id: string; name: string; email: string; role: string; active: boolean; createdAt: string }[];
    },
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/api/users', form)).data,
    onSuccess: () => { setShow(false); setForm({ name: '', email: '', password: '', role: 'CASHIER' }); setMsg('User created.'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const toggle = useMutation({
    mutationFn: async (u: { id: string; active: boolean }) => (await api.patch(`/api/users/${u.id}`, { active: !u.active })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Users & roles</h1><p className="text-sm opacity-60">Minimum-necessary access: cashiers can't see this page's API at all</p></div>
        <Button onClick={() => setShow(true)}><Plus size={16} /> Add user</Button>
      </div>
      {msg && <p className="text-sm" role="status">{msg}</p>}
      {show && (
        <Card>
          <h2 className="mb-3 font-bold">New team member</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Full name *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Work email *"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temporary password * (min 8)"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="CASHIER">Cashier (OTC sales)</option>
                <option value="TECHNICIAN">Technician (stock + catalog)</option>
                <option value="PHARMACIST">Pharmacist (verify Rx, voids)</option>
                <option value="ADMIN">Admin (full access)</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2"><Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button></div>
        </Card>
      )}
      {(data?.users ?? []).length === 0 ? <Empty title="No users" /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Since</th><th>Action</th></tr></thead>
          <tbody>{(data?.users ?? []).map((u) => (
            <tr key={u.id}>
              <td className="font-semibold">{u.name}{me?.id === u.id ? ' (you)' : ''}</td>
              <td>{u.email}</td>
              <td><Badge tone={u.role === 'ADMIN' ? 'blue' : u.role === 'PHARMACIST' ? 'green' : 'gray'}>{u.role}</Badge></td>
              <td><Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Disabled'}</Badge></td>
              <td>{fmtDateTime(u.createdAt)}</td>
              <td><Button variant="ghost" disabled={me?.id === u.id} onClick={() => { if (confirm(`${u.active ? 'Disable' : 'Enable'} ${u.name}?`)) toggle.mutate(u); }}>{u.active ? 'Disable' : 'Enable'}</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
