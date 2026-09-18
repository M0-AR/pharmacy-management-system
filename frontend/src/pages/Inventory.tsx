import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { Badge, Button, Card, Field, Input, Select } from '../components/ui';
import { can, useAuth } from '../lib/auth';
import { fmtDateTime, usd } from '../lib/format';

export function Inventory() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [adjustId, setAdjustId] = useState('');
  const [changeQty, setChangeQty] = useState('10');
  const [reason, setReason] = useState('PURCHASE');
  const [note, setNote] = useState('');

  const low = useQuery({ queryKey: ['low-stock'], queryFn: async () => (await api.get('/api/medicines/low-stock')).data });
  const expired = useQuery({ queryKey: ['expired'], queryFn: async () => (await api.get('/api/medicines/expired')).data });
  const catalog = useQuery({
    queryKey: ['medicines-all'],
    queryFn: async () => (await api.get('/api/medicines', { params: { pageSize: 100 } })).data as { items: { id: string; name: string; code: string; quantity: number }[] },
  });

  const adjust = useMutation({
    mutationFn: async () => (await api.post(`/api/medicines/${adjustId}/adjust`, { changeQty: Number(changeQty), reason, note })).data,
    onSuccess: () => { setMsg('Stock adjusted and ledgered.'); setAdjustId(''); setNote(''); qc.invalidateQueries({ queryKey: ['low-stock'] }); qc.invalidateQueries({ queryKey: ['medicines'] }); qc.invalidateQueries({ queryKey: ['medicines-all'] }); qc.invalidateQueries({ queryKey: ['summary'] }); },
    onError: (e) => setMsg(apiError(e)),
  });

  const lowItems = low.data?.items ?? [];
  const expItems = expired.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Inventory & alerts</h1>
        <p className="text-sm opacity-60">Low-stock guardrails, expired quarantine, and an auditable stock ledger.</p>
      </div>
      {msg && <p className="text-sm" role="status">{msg}</p>}

      {can(user, 'ADMIN', 'PHARMACIST', 'TECHNICIAN') && (
        <Card>
          <h2 className="mb-3 font-bold">Adjust stock (purchase / correction / expiry removal)</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="Medicine">
              <Select value={adjustId} onChange={(e) => setAdjustId(e.target.value)}>
                <option value="">Select…</option>
                {(catalog.data?.items ?? []).map((m: { id: string; name: string; code: string; quantity: number }) => <option key={m.id} value={m.id}>{m.code} — {m.name} ({m.quantity})</option>)}
              </Select>
            </Field>
            <Field label="Change (+ in / − out)"><Input type="number" value={changeQty} onChange={(e) => setChangeQty(e.target.value)} /></Field>
            <Field label="Reason">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="PURCHASE">PURCHASE</option><option value="ADJUSTMENT">ADJUSTMENT</option>
                <option value="EXPIRED">EXPIRED</option><option value="RETURN">RETURN</option>
              </Select>
            </Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="PO-1042…" /></Field>
            <div className="flex items-end"><Button onClick={() => adjust.mutate()} disabled={!adjustId || adjust.isPending}>Apply</Button></div>
          </div>
          <p className="mt-2 text-xs opacity-60">Every adjustment writes a <code>stock_movements</code> row with who/when/why — required for DEA-style variance checks.</p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Low stock (≤ threshold)</h2><Badge tone="amber">{lowItems.length}</Badge></div>
          {lowItems.length === 0 ? <p className="text-sm opacity-60">Nothing low. Reorder point default is 10 units.</p> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Code</th><th>Name</th><th>Qty</th><th>Price</th></tr></thead>
              <tbody>{lowItems.map((m: { id: string; code: string; name: string; quantity: number; unitPrice: number }) => (
                <tr key={m.id}><td className="font-mono text-xs">{m.code}</td><td className="font-semibold">{m.name}</td><td>{m.quantity}</td><td>{usd(m.unitPrice)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Expired — do not dispense</h2><Badge tone="red">{expItems.length}</Badge></div>
          {expItems.length === 0 ? <p className="text-sm opacity-60">No expired stock. POS blocks expired items automatically.</p> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Code</th><th>Name</th><th>Qty</th><th>Expired</th></tr></thead>
              <tbody>{expItems.map((m: { id: string; code: string; name: string; quantity: number; expiryDate: string }) => (
                <tr key={m.id}><td className="font-mono text-xs">{m.code}</td><td className="font-semibold">{m.name}</td><td>{m.quantity}</td><td>{new Date(m.expiryDate).toLocaleDateString()}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-bold">How expiry is enforced</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm opacity-80">
          <li>POS <em>refuses</em> expired lines server-side (not just UI hiding).</li>
          <li>Voiding a sale restocks via ledgered <code>RETURN</code> movements.</li>
          <li>Quarantine expired units with an <code>EXPIRED</code> adjustment (negative qty) before disposal per state board rules.</li>
        </ul>
        <p className="mt-2 text-xs opacity-60">Last checked: {fmtDateTime(new Date().toISOString())}</p>
      </Card>
    </div>
  );
}
