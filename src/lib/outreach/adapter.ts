// Firebase → Lead adapter. Maps the existing sourcing data model
// (SourcedParkingLocation + OutreachRecord, both snake_case) onto the
// Outreach Desk's Lead shape so the pure workflow logic (workflow.ts) runs
// unchanged on top of it. No writes here — read-only mapping.

import type { SourcedParkingLocation, OutreachRecord } from '@/lib/sourcing/types';
import { missingChecklistCount, isFloodFailed } from '@/lib/sourcing/bdrView';
import type { Lead, Raw } from './workflow';

// Local source-label map — bdrView's sourceLabel reads `location.source`,
// which no longer exists on the snake_case type, so we map source_name here.
const SOURCE_LABELS: Record<string, string> = {
  spothero: 'SpotHero',
  parkopedia: 'Parkopedia',
  manual: 'Manually added',
  laz: 'LAZ Parking',
  extension: 'Extension capture',
};

function sourceLabel(sourceName: string): string {
  return SOURCE_LABELS[sourceName] ?? sourceName;
}

/** Derive the Outreach Desk stage from checklist + outreach state. */
export function deriveStage(
  lot: SourcedParkingLocation,
  outreach: OutreachRecord | null,
): string {
  if (isFloodFailed(lot)) return 'hold';
  if (!outreach) {
    return missingChecklistCount(lot) > 0 ? 'research' : 'verify';
  }
  switch (outreach.status) {
    case 'ready':
      return 'ready';
    case 'sent':
      return 'email_followup';
    case 'called':
      return 'sdr';
    case 'responded':
      return 'email_reply';
    case 'quoted':
      return 'qualified';
    default:
      return 'research';
  }
}

/** Derive a 1–4 priority string from checklist + outreach state.
 * 1 = buyer signal (responded/quoted), 2 = in outreach, 3 = needs research,
 * 4 = flood-failed/hold. */
function derivePriority(
  lot: SourcedParkingLocation,
  outreach: OutreachRecord | null,
): string {
  if (isFloodFailed(lot)) return '4';
  if (!outreach) return '3';
  switch (outreach.status) {
    case 'responded':
    case 'quoted':
      return '1';
    case 'ready':
    case 'sent':
    case 'called':
      return '2';
    default:
      return '3';
  }
}

/** Real users per role — built from the users collection. */
export type RoleUsers = { bdr: string[]; sdr: string[]; researcher: string[] };

/** Derive the assignee from the stage + real users. */
function deriveAssignee(
  lot: SourcedParkingLocation,
  outreach: OutreachRecord | null,
  stage: string,
  users: RoleUsers,
): string {
  if (outreach?.assigned_to) return outreach.assigned_to;
  // Territory-based BDR split (same hash as workflow.bdrOwner).
  const territory = [...deriveOperator(lot)].reduce((a, c) => a + c.charCodeAt(0), 0) % 2;
  switch (stage) {
    case 'ready':
    case 'email_followup':
    case 'email_reply':
      return users.bdr.length ? users.bdr[territory % users.bdr.length] : 'Unassigned';
    case 'sdr':
    case 'followup':
    case 'qualified':
      return users.sdr[0] ?? 'Unassigned';
    case 'research':
    case 'verify':
      return users.researcher[0] ?? 'Unassigned';
    default:
      return 'Unassigned';
  }
}

/** Derive the commercial operator/owner from enrichment signals, falling back
 * to the source label. Priority: parcel owner → OSM owner → corporate entity →
 * business license → source. This is the seed for the future company_accounts
 * layer — one operator controls many lots. */
export function deriveOperator(lot: SourcedParkingLocation): string {
  return (
    lot.enrichment?.parcel?.ownerOfRecord ||
    lot.enrichment?.pitstop?.owner ||
    lot.enrichment?.corporate_entity?.entityName ||
    lot.enrichment?.business_license?.businessName ||
    sourceLabel(lot.source_name)
  );
}

/** Stable slug for the operator — the seed of the company_accounts key. */
export function accountSlug(operator: string): string {
  return operator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildRaw(lot: SourcedParkingLocation, outreach: OutreachRecord | null): Raw {
  const tri = (v: boolean | null | undefined) =>
    v === true ? 'yes' : v === false ? 'no' : '';
  return {
    id: lot.id,
    name: lot.name,
    address: lot.address ?? '',
    operator: deriveOperator(lot),
    contact_name: outreach?.contact_name ?? '',
    email: outreach?.contact_email ?? '',
    phone: outreach?.contact_phone ?? '',
    priority: derivePriority(lot, outreach),
    status: lot.status,
    requested_spaces: String(lot.stall_count ?? 20),
    next_action: '',
    contact_group: deriveOperator(lot),
    company_account_id: accountSlug(deriveOperator(lot)),
    contact_source: outreach?.quote_source ?? lot.source_url ?? '',
    locality: lot.locality ?? '',
    // Follow-up engine — next_touch_at is written by logEmailSent (+3 days).
    next_touch_at: (outreach as (OutreachRecord & { next_touch_at?: string }) | null)?.next_touch_at ?? '',
    // Coordinates — for the map view.
    lat: lot.lat != null ? String(lot.lat) : '',
    lng: lot.lng != null ? String(lot.lng) : '',
    // Raw 7-field checklist data — the Work Queue dense matrix reads these.
    stall_count: lot.stall_count != null ? String(lot.stall_count) : '',
    is_24_7: tri(lot.is_24_7),
    is_fenced: tri(lot.is_fenced),
    is_lit: tri(lot.is_lit),
    ingress_egress: lot.ingress_egress ?? '',
    clearance_text: lot.clearance_text ?? '',
    price_text: lot.price_text ?? '',
    hours_text: lot.hours_text ?? '',
    source_name: lot.source_name,
  };
}

function buildPropertyDetails(lot: SourcedParkingLocation): Record<string, string> {
  const ev =
    (lot.enrichment?.ev?.onSiteDcFastPorts ?? 0) > 0 ||
    (lot.enrichment?.ev?.onSiteLevel2Ports ?? 0) > 0
      ? 'yes'
      : '';
  return {
    owner: lot.enrichment?.parcel?.ownerOfRecord ?? '',
    operator: deriveOperator(lot),
    total_spaces: lot.stall_count != null ? String(lot.stall_count) : '',
    hours: lot.hours_text ?? '',
    clearance: lot.clearance_text ?? '',
    gate: lot.gate_type ?? '',
    ev,
    pudo: '',
    staging: '',
    accessible_routes: '',
  };
}

export function makeLead(
  lot: SourcedParkingLocation,
  outreach: OutreachRecord | null,
  users: RoleUsers = { bdr: [], sdr: [], researcher: [] },
): Lead {
  const stage = deriveStage(lot, outreach);
  // New outreach-layer fields written by lib/outreach/actions.ts — not yet on
  // the SourcedParkingLocation type, so read them via a narrow cast.
  const ext = lot as SourcedParkingLocation & {
    priority?: number;
    visibility?: 'active' | 'hidden' | 'archived';
  };
  return {
    id: lot.id,
    raw: buildRaw(lot, outreach),
    stage,
    assignee: deriveAssignee(lot, outreach, stage, users),
    contact_name: outreach?.contact_name ?? '',
    contact_role: outreach?.contact_title ?? '',
    email: outreach?.contact_email ?? '',
    phone: outreach?.contact_phone ?? '',
    verified: 0,
    evidence: outreach?.quote_source ?? '',
    notes: lot.notes ?? '',
    due: '',
    updated: lot.updated_at ?? '',
    revision: 0,
    research: null,
    priority_rating: ext.priority,
    visibility: ext.visibility,
    property_details: buildPropertyDetails(lot),
    property_evidence: '',
    property_sources: lot.source_url ? { source: lot.source_url } : {},
  };
}