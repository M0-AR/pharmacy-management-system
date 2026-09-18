import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, Empty } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function Audit() {
  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get('/api/audit-logs', { params: { pageSize: 50 } })).data as {
      items: { id: string; action: string; entity: string; entityId: string | null; ip: string | null; createdAt: string; actor: { name: string; email: string } | null }[];
      total: number;
    },
  });
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-extrabold">Audit trail</h1><p className="text-sm opacity-60">{data?.total ?? 0} events · append-only · who did what, when, from where</p></div>
      <Card>
        <p className="text-sm opacity-70">Every login, medicine change, stock adjustment, sale, and void is recorded with actor + timestamp + IP. This table is insert-only (no update/delete API) to preserve HIPAA audit-control integrity.</p>
      </Card>
      {(data?.items ?? []).length === 0 ? <Empty title="No audit events yet" /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead>
          <tbody>{(data?.items ?? []).map((a) => (
            <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actor ? `${a.actor.name}` : '—'}</td><td className="font-mono text-xs">{a.action}</td><td>{a.entity}{a.entityId ? ` · ${a.entityId.slice(-6)}` : ''}</td><td className="font-mono text-xs">{a.ip ?? '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
