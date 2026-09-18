import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { STORE_DEFAULTS } from '../lib/store';

const KEYS = [
  ['store.name', 'Pharmacy name'],
  ['store.tagline', 'Tagline'],
  ['store.address', 'Address'],
  ['store.phone', 'Phone'],
  ['store.receiptFooter', 'Receipt footer message'],
] as const;

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/api/settings')).data as { settings: Record<string, string> },
  });
  const values = form ?? { ...STORE_DEFAULTS, ...(data?.settings ?? {}) };

  const save = useMutation({
    mutationFn: async () => (await api.put('/api/settings', { settings: values })).data,
    onSuccess: () => { setMsg('Store profile saved — invoice and sidebar update instantly.'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const changePw = useMutation({
    mutationFn: async () => (await api.post('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })).data,
    onSuccess: () => { setPwMsg('Password changed.'); setPw({ currentPassword: '', newPassword: '', confirm: '' }); },
    onError: (e) => setPwMsg(apiError(e)),
  });

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-extrabold">Settings</h1><p className="text-sm opacity-60">White-label your store + manage your own sign-in</p></div>
      {msg && <p className="text-sm" role="status">{msg}</p>}

      {user?.role === 'ADMIN' ? (
        <Card>
          <h2 className="mb-1 font-bold">Store profile (white-label)</h2>
          <p className="mb-4 text-sm opacity-60">Shown on the sidebar, login screen, and every printed invoice. This is what makes the system yours to resell.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {KEYS.map(([key, label]) => (
              <Field key={key} label={label}>
                <Input value={values[key] ?? ''} onChange={(e) => setForm({ ...values, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-3"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save store profile</Button></div>
        </Card>
      ) : (
        <Card><p className="text-sm opacity-70">Store profile is managed by your administrator.</p></Card>
      )}

      <Card>
        <h2 className="mb-1 font-bold">Change my password</h2>
        <p className="mb-4 text-sm opacity-60">Signed in as {user?.email} ({user?.role})</p>
        <div className="grid max-w-xl gap-3">
          <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password (min 8)"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        {pwMsg && <p className="mt-2 text-sm" role="status">{pwMsg}</p>}
        <div className="mt-3">
          <Button
            disabled={changePw.isPending || !pw.currentPassword || pw.newPassword.length < 8 || pw.newPassword !== pw.confirm}
            onClick={() => changePw.mutate()}
          >
            Change password
          </Button>
          {pw.newPassword && pw.confirm && pw.newPassword !== pw.confirm && <p className="mt-1 text-xs text-red-600">New passwords don't match.</p>}
        </div>
      </Card>
    </div>
  );
}
