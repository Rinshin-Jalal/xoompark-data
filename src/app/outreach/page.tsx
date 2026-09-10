import 'server-only';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { listSourcedLocations } from '@/lib/sourcing/store';
import type { OutreachRecord } from '@/lib/sourcing/types';
import { makeLead } from '@/lib/outreach/adapter';
import { plan, today, defaults } from '@/lib/outreach/workflow';
import type { Data } from '@/lib/outreach/workflow';
import Workspace from '@/components/outreach/workspace';

// One collection-group read for every outreach record, keyed by parent lot id
// — same pattern as parking-sourcing/actions.ts getOutreachBatch.
async function getOutreachMap(): Promise<Record<string, OutreachRecord>> {
  const db = getAdminFirestore();
  const snap = await db.collectionGroup('outreach').get();
  const map: Record<string, OutreachRecord> = {};
  for (const doc of snap.docs) {
    const lotId = doc.ref.parent?.parent?.id;
    if (lotId) map[lotId] = doc.data() as OutreachRecord;
  }
  return map;
}

export default async function OutreachPage() {
  const lots = await listSourcedLocations({});
  const outreachMap = await getOutreachMap();
  const leads = lots.map((lot) => makeLead(lot, outreachMap[lot.id] ?? null));
  const day = today();
  const data: Data = {
    leads,
    tasks: plan(leads, day, defaults.dailyLimit),
    activity: [],
    notifications: [],
    email_events: [],
    settings: defaults,
    day,
  };
  return <Workspace initialData={data} />;
}