import 'server-only';
import { getAdminFirestore, getDefaultFirestore } from '@/lib/firebaseAdmin';
import { listSourcedLocations } from '@/lib/sourcing/store';
import type { OutreachRecord } from '@/lib/sourcing/types';
import { makeLead, type RoleUsers } from '@/lib/outreach/adapter';
import { plan, today, defaults } from '@/lib/outreach/workflow';
import type { Data } from '@/lib/outreach/workflow';

// One collection-group read for every outreach record, keyed by parent lot id.
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

// Active deals per account — for the cold-outreach lockout.
async function getAccountDeals(): Promise<Record<string, { dealId: string; stage: string }>> {
  const db = getAdminFirestore();
  const snap = await db.collection('company_accounts').get();
  const map: Record<string, { dealId: string; stage: string }> = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.active_deal_id) map[doc.id] = { dealId: d.active_deal_id, stage: d.current_pipeline_stage ?? '' };
  }
  return map;
}

// Real users per role — from the users collection (default Firestore).
async function getRoleUsers(): Promise<RoleUsers> {
  const db = getDefaultFirestore();
  const snap = await db.collection('users').get();
  const users: RoleUsers = { bdr: [], sdr: [], researcher: [] };
  for (const doc of snap.docs) {
    const d = doc.data();
    const roles: string[] = Array.isArray(d.roles) ? d.roles : [];
    const name = d.displayName || (d.email ?? '').split('@')[0];
    if (roles.includes('bdr')) users.bdr.push(name);
    if (roles.includes('sdr')) users.sdr.push(name);
    if (roles.includes('researcher')) users.researcher.push(name);
  }
  users.bdr.sort();
  users.sdr.sort();
  users.researcher.sort();
  return users;
}

export async function getOutreachData(): Promise<Data> {
  const lots = await listSourcedLocations({});
  const outreachMap = await getOutreachMap();
  const accountDeals = await getAccountDeals();
  const roleUsers = await getRoleUsers();
  const leads = lots.map((lot) => {
    const lead = makeLead(lot, outreachMap[lot.id] ?? null, roleUsers);
    const deal = accountDeals[lead.raw.company_account_id ?? ''];
    if (deal) lead.raw.lockout = deal.stage;
    return lead;
  });
  const day = today();
  return {
    leads,
    tasks: plan(leads, day, defaults.dailyLimit),
    activity: [],
    notifications: [],
    email_events: [],
    settings: defaults,
    day,
  };
}