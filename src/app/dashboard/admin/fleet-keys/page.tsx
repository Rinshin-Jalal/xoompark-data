import 'server-only';
import { requireAdmin } from '@/lib/requireAdmin';
import { getDefaultFirestore } from '@/lib/firebaseAdmin';
import { FleetKeysClient, type FleetKeyRow } from './_components/FleetKeysClient';

export const dynamic = 'force-dynamic';

export default async function FleetKeysPage() {
  await requireAdmin();

  const db = getDefaultFirestore();
  const snap = await db.collection('operatorApiKeys').where('role', '==', 'fleet').get();
  const keys: FleetKeyRow[] = snap.docs
    .map((d) => {
      const data = d.data() as {
        label?: string; status?: string; createdAt?: { toDate(): Date }; lastUsedAt?: unknown;
      };
      const lastUsed = data.lastUsedAt;
      return {
        id: d.id,
        label: data.label ?? d.id.slice(0, 12),
        status: data.status ?? 'ACTIVE',
        createdAt: data.createdAt?.toDate().toISOString() ?? null,
        lastUsedAt:
          typeof lastUsed === 'string' ? lastUsed
          : lastUsed && typeof lastUsed === 'object' && 'toDate' in (lastUsed as object)
            ? (lastUsed as { toDate(): Date }).toDate().toISOString()
            : null,
      };
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return <FleetKeysClient initialKeys={keys} />;
}
