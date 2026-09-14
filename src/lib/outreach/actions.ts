'use server';

import { revalidatePath } from 'next/cache';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { setOutreachState, getOutreachRecord } from '@/lib/sourcing/outreachStore';
import { getSourcedLocation } from '@/lib/sourcing/store';
import type { OutreachState } from '@/lib/sourcing/types';

const LOTS = 'parking_lots';

// ── Activity log (who did what, when) ──────────────────────────────────────
async function logActivity(actor: string, leadId: string, message: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection('activity').add({
    lead_id: leadId,
    actor,
    message,
    created: new Date().toISOString(),
  });
}

export async function getActivity(leadId: string): Promise<{ actor: string; message: string; created: string }[]> {
  const db = getAdminFirestore();
  const snap = await db.collection('activity').where('lead_id', '==', leadId).orderBy('created', 'desc').limit(50).get();
  return snap.docs.map((d) => d.data() as { actor: string; message: string; created: string });
}

// ── Stage advance (the core pipeline move) ────────────────────────────────
// Reuses the existing outreachStore.setOutreachState — no new write path.
export async function advanceStage(lotId: string, status: OutreachState): Promise<void> {
  const admin = await requireAdmin();
  await setOutreachState(lotId, status);
  await logActivity(admin.email, lotId, `Stage → ${status}`);
  revalidatePath('/', 'layout');
}

// ── Priority (1-4) ────────────────────────────────────────────────────────
export async function setPriority(lotId: string, rating: number): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(LOTS).doc(lotId).update({ priority: rating });
  await logActivity(admin.email, lotId, `Priority → ${rating}`);
  revalidatePath('/', 'layout');
}

// ── Visibility (active | hidden | archived) ───────────────────────────────
// Separate from the existing `status` (draft|saved) — visibility is the
// outreach-layer off-ramp, status is the sourcing-layer completeness flag.
export async function setVisibility(
  lotId: string,
  visibility: 'active' | 'hidden' | 'archived',
): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(LOTS).doc(lotId).update({ visibility });
  await logActivity(admin.email, lotId, `Visibility → ${visibility}`);
  revalidatePath('/', 'layout');
}

// ── Disqualify (terminal off-ramp with reason) ────────────────────────────
export async function disqualifyLot(lotId: string, reason: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(LOTS).doc(lotId).update({
    visibility: 'archived',
    disqualification_reason: reason,
  });
  await logActivity(admin.email, lotId, `Disqualified: ${reason}`);
  revalidatePath('/', 'layout');
}

// ── Restore ───────────────────────────────────────────────────────────────
export async function restoreLot(lotId: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(LOTS).doc(lotId).update({
    visibility: 'active',
    disqualification_reason: null,
  });
  await logActivity(admin.email, lotId, 'Restored');
  revalidatePath('/', 'layout');
}

// ── Clear a wrong contact (SDR disposition: wrong contact) ────────────────
// Deletes the outreach record so the lot falls back to `verify` (research).
export async function clearContact(lotId: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const outreachRef = db.collection(LOTS).doc(lotId).collection('outreach');
  const snap = await outreachRef.limit(1).get();
  for (const doc of snap.docs) await doc.ref.delete();
  await logActivity(admin.email, lotId, 'Contact cleared');
  revalidatePath('/', 'layout');
}

// ── Log an email sent (BDR Email write) ───────────────────────────────────
// Marks email_sent, advances to `sent`, and schedules the follow-up touch
// +3 business days (the follow-up engine's seed).
export async function logEmailSent(lotId: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const outreachRef = db.collection(LOTS).doc(lotId).collection('outreach');
  const snap = await outreachRef.limit(1).get();
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 3);
  const nextTouchAt = next.toISOString();

  if (snap.empty) {
    const ref = outreachRef.doc();
    await ref.set({
      id: ref.id,
      lot_id: lotId,
      contact_name: '',
      contact_title: '',
      contact_email: '',
      contact_phone: '',
      email_sent: true,
      call_completed: false,
      form_submitted: false,
      offered_spaces: null,
      offered_price: '',
      offered_start_date: '',
      status: 'sent',
      response_date: null,
      quote_source: '',
      assigned_to: '',
      next_touch_at: nextTouchAt,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  } else {
    await snap.docs[0].ref.update({
      email_sent: true,
      status: 'sent',
      next_touch_at: nextTouchAt,
      updated_at: now.toISOString(),
    });
  }
  await logActivity(admin.email, lotId, 'Email sent');
  revalidatePath('/', 'layout');
}
// Writes the snake_case field directly. Tri-state booleans accept true/false/
// null (null = checked, couldn't tell). Text fields accept a string.
export async function saveField(
  lotId: string,
  field: string,
  value: string | number | boolean | null,
): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(LOTS).doc(lotId).update({
    [field]: value,
    updated_at: new Date().toISOString(),
  });
  await logActivity(admin.email, lotId, `Field ${field} saved`);
  revalidatePath('/', 'layout');
}

// ── Save a decision-maker contact (Research Desk write) ───────────────────
// Creates or updates the outreach subcollection record with the contact and
// moves the lot to `ready` (BDR email). No new write path — same subcollection
// the existing outreachStore uses.
export async function saveContact(
  lotId: string,
  contact: { name: string; role: string; email: string; phone: string },
): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const outreachRef = db.collection(LOTS).doc(lotId).collection('outreach');
  const snap = await outreachRef.limit(1).get();
  const now = new Date().toISOString();

  if (snap.empty) {
    const ref = outreachRef.doc();
    await ref.set({
      id: ref.id,
      lot_id: lotId,
      contact_name: contact.name,
      contact_title: contact.role,
      contact_email: contact.email,
      contact_phone: contact.phone,
      email_sent: false,
      call_completed: false,
      form_submitted: false,
      offered_spaces: null,
      offered_price: '',
      offered_start_date: '',
      status: 'ready',
      response_date: null,
      quote_source: '',
      assigned_to: '',
      created_at: now,
      updated_at: now,
    });
  } else {
    await snap.docs[0].ref.update({
      contact_name: contact.name,
      contact_title: contact.role,
      contact_email: contact.email,
      contact_phone: contact.phone,
      status: 'ready',
      updated_at: now,
    });
  }
  await logActivity(admin.email, lotId, `Contact saved: ${contact.name}`);
  revalidatePath('/', 'layout');
}
// ── Promote a lot to a BD prospect (the bridge) ────────────────────────────
// Triggered at `responded`/`quoted` (buyer signal). Creates a bdProspect with
// mapped fields, a lotProspectLinks bridge record, and writes prospect_id back
// to the outreach record. bdProspects is camelCase (pipeline/types.ts).
export async function createProspectFromLot(lotId: string): Promise<{ prospectId: string }> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();

  const lot = await getSourcedLocation(lotId);
  if (!lot) throw new Error('Lot not found');
  const outreach = await getOutreachRecord(lotId);
  if (!outreach) throw new Error('No outreach record — cannot promote');
  if (!outreach.contact_name) throw new Error('No decision-maker identified — cannot promote');

  // Duplicate check
  const existing = await db.collection('lotProspectLinks').where('lot_id', '==', lotId).limit(1).get();
  if (!existing.empty) throw new Error('Already promoted to a prospect');

  const companyName =
    lot.enrichment?.parcel?.ownerOfRecord ||
    lot.enrichment?.pitstop?.owner ||
    lot.enrichment?.corporate_entity?.entityName ||
    lot.name;

  const now = new Date().toISOString();

  // Account link — the operator entity this lot belongs to.
  const { deriveOperator, accountSlug } = await import('@/lib/outreach/adapter');
  const accountId = accountSlug(deriveOperator(lot));

  // All lots under the same account (portfolio scope).
  const siblingLots = await db.collection(LOTS).where('company_account_id', '==', accountId).get();
  const associatedLotIds = siblingLots.docs.map((d) => d.id);
  const totalStalls = siblingLots.docs.reduce((sum, d) => sum + (d.data().stall_count ?? 0), 0);

  const prospectRef = db.collection('bdProspects').doc();
  await prospectRef.set({
    id: prospectRef.id,
    side: 'provider',
    stage: 'QUALIFYING',
    companyName,
    contactName: outreach.contact_name,
    contactTitle: outreach.contact_title,
    contactEmail: outreach.contact_email,
    contactPhone: outreach.contact_phone,
    website: lot.source_url ?? '',
    city: lot.locality ?? '',
    description: `Sourced from parking inventory. ${lot.stall_count ?? '?'} stalls. ${lot.source_name}.`,
    source: 'COLD_OUTREACH',
    assignedTo: outreach.assigned_to || '',
    lastContactedAt: null,
    nextFollowUp: null,
    tags: ['promoted_from_sourcing'],
    company_account_id: accountId,
    associated_lot_ids: associatedLotIds,
    total_stalls_in_deal: totalStalls,
    deal_type: associatedLotIds.length > 1 ? 'portfolio_master_agreement' : 'single_site',
    providerDetails: {
      providerType: 'PARKING_OPERATOR',
      infraType: lot.surface_type === 'surface' ? 'SURFACE_LOT' : 'PARKING_GARAGE',
      estimatedSpaces: lot.stall_count ?? null,
      estimatedLocations: associatedLotIds.length,
      servicesInterested: [],
      currentlyMonetized: lot.price_text ? true : null,
    },
    operatorDetails: null,
    createdAt: now,
    updatedAt: now,
    createdBy: 'system',
  });

  // Bridge record — permanent link for conversion analytics
  const linkRef = db.collection('lotProspectLinks').doc();
  await linkRef.set({
    id: linkRef.id,
    lot_id: lotId,
    prospect_id: prospectRef.id,
    promoted_at: now,
    promoted_by: 'system',
  });

  // Write prospect_id back to the outreach record
  await db.collection(LOTS).doc(lotId).collection('outreach').doc(outreach.id).update({
    prospect_id: prospectRef.id,
  });

  // Lock the account — cold outreach restricted while a deal is in flight.
  await db.collection('company_accounts').doc(accountId).set(
    {
      id: accountId,
      name: deriveOperator(lot),
      active_deal_id: prospectRef.id,
      current_pipeline_stage: 'QUALIFYING',
      updated_at: now,
    },
    { merge: true },
  );

  await logActivity(admin.email, lotId, 'Promoted to prospect');
  revalidatePath('/', 'layout');
  return { prospectId: prospectRef.id };
}

// ── Sync company accounts (the operator entity layer) ─────────────────────
// Groups lots by derived operator, creates/updates a company_accounts doc per
// operator, and writes company_account_id back to each lot. Run on demand or
// after ingest. This is the seed of portfolio deals + cold-outreach lockout.
export async function syncCompanyAccounts(): Promise<{ accounts: number }> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const { listSourcedLocations } = await import('@/lib/sourcing/store');
  const { deriveOperator, accountSlug } = await import('@/lib/outreach/adapter');

  const lots = await listSourcedLocations({});
  const groups = new Map<string, { operator: string; lots: string[] }>();

  for (const lot of lots) {
    const operator = deriveOperator(lot);
    const slug = accountSlug(operator);
    if (!groups.has(slug)) groups.set(slug, { operator, lots: [] });
    groups.get(slug)!.lots.push(lot.id);
  }

  const now = new Date().toISOString();
  let count = 0;
  for (const [slug, { operator, lots }] of groups) {
    await db.collection('company_accounts').doc(slug).set(
      {
        id: slug,
        name: operator,
        account_type: 'operator',
        domain: '',
        active_lot_count: lots.length,
        active_deal_id: null,
        current_pipeline_stage: null,
        updated_at: now,
      },
      { merge: true },
    );
    for (const lotId of lots) {
      await db.collection(LOTS).doc(lotId).update({ company_account_id: slug });
    }
    count++;
  }

  revalidatePath('/', 'layout');
  return { accounts: count };
}

// ── Quick Add (one paste box → lot) ───────────────────────────────────────
// Detects URL vs address. URL → parse + import via the existing sourcing
// actions. Address → create a minimal manual lot. Returns a human-readable
// summary for the toast.

/** Normalize pasted input: prepend https:// when a bare domain is pasted. */
function normalizeInput(input: string): { isUrl: boolean; value: string } {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return { isUrl: true, value: trimmed };
  if (/^[\w-]+\.(com|org|net|io|co|app|dev)\b/i.test(trimmed)) return { isUrl: true, value: `https://${trimmed}` };
  return { isUrl: false, value: trimmed };
}

export async function quickAddLot(input: string): Promise<{ message: string }> {
  const admin = await requireAdmin();
  const { isUrl, value: trimmed } = normalizeInput(input);
  if (!trimmed) throw new Error('Paste a URL or address');

  if (isUrl) {
    const { parseSourceUrl, importParsedSourceLocations } = await import('@/app/dashboard/admin/parking-sourcing/actions');
    const parsed = await parseSourceUrl(trimmed);
    if (!parsed.ok) throw new Error(parsed.error);
    const imported = await importParsedSourceLocations(parsed.results);
    if (!imported.ok) throw new Error(imported.error);
    return { message: `Imported ${imported.imported} lot${imported.imported === 1 ? '' : 's'}${imported.merged ? `, merged ${imported.merged}` : ''}` };
  }

  // Address → minimal manual lot
  const { upsertSourcedLocation } = await import('@/lib/sourcing/store');
  const name = trimmed.split(',')[0].trim() || trimmed;
  await upsertSourcedLocation({
    name,
    address: trimmed,
    source: 'manual',
    sourceUrl: '',
    capturedBy: 'admin',
    rawInput: { address: trimmed },
  });
  await logActivity(admin.email, '', `Added lot: ${name}`);
  revalidatePath('/', 'layout');
  return { message: `Added "${name}"` };
}

// ── Enrich a lot (Level 1: scrape + regex extract) ─────────────────────────
// Fetches the lot's source URL, extracts fields with regex, and stores the
// result with provenance on the lot. Firecrawl/Exa/LLM plug in later.
export async function enrichLot(lotId: string): Promise<{ status: string; fields: number }> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const { scrapeAndExtract } = await import('@/lib/outreach/enrichment');

  const lot = await getSourcedLocation(lotId);
  if (!lot) throw new Error('Lot not found');
  if (!lot.source_url) throw new Error('No source URL to scrape');

  const result = await scrapeAndExtract(lot.source_url);
  await db.collection(LOTS).doc(lotId).update({
    ai_enrichment: result,
    enriched_at: new Date().toISOString(),
  });
  await logActivity(admin.email, lotId, `Enriched: ${result.status} (${result.fields.length} fields)`);
  revalidatePath('/', 'layout');
  return { status: result.status, fields: result.fields.length };
}

// ── Preview a lot before adding (Quick Add confirmation) ───────────────────
// Parses the input (URL → parse, address → minimal) and returns the details
// WITHOUT writing. The UI shows these in a confirm dialog, then calls
// quickAddLot on confirm.
export async function previewLot(input: string): Promise<{ name: string; address: string; source: string; count: number }> {
  await requireAdmin();
  const { isUrl, value: trimmed } = normalizeInput(input);
  if (!trimmed) throw new Error('Paste a URL or address');

  if (isUrl) {
    const { parseSourceUrl } = await import('@/app/dashboard/admin/parking-sourcing/actions');
    const parsed = await parseSourceUrl(trimmed);
    if (!parsed.ok) throw new Error(parsed.error);
    const first = parsed.results[0];
    return {
      name: (first as { name?: string })?.name ?? trimmed,
      address: (first as { address?: string })?.address ?? '',
      source: parsed.kind,
      count: parsed.results.length,
    };
  }
  return {
    name: trimmed.split(',')[0].trim() || trimmed,
    address: trimmed,
    source: 'manual',
    count: 1,
  };
}

// ── All activity (admin viewer) ────────────────────────────────────────────
export async function getAllActivity(limit = 100): Promise<{ actor: string; message: string; created: string; lead_id: string }[]> {
  await requireAdmin();
  const db = getAdminFirestore();
  const snap = await db.collection('activity').orderBy('created', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as { actor: string; message: string; created: string; lead_id: string });
}
