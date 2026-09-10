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

/** Derive a 1–4 priority string from checklist + outreach state. */
function derivePriority(
  lot: SourcedParkingLocation,
  outreach: OutreachRecord | null,
): string {
  if (isFloodFailed(lot)) return '4';
  if (!outreach) return '1';
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

function buildRaw(lot: SourcedParkingLocation, outreach: OutreachRecord | null): Raw {
  return {
    id: lot.id,
    name: lot.name,
    address: lot.address ?? '',
    operator: sourceLabel(lot.source_name),
    contact_name: outreach?.contact_name ?? '',
    email: outreach?.contact_email ?? '',
    phone: outreach?.contact_phone ?? '',
    priority: derivePriority(lot, outreach),
    status: lot.status,
    requested_spaces: String(lot.stall_count ?? 20),
    next_action: '',
    contact_group: lot.source_name,
    contact_source: outreach?.quote_source ?? lot.source_url ?? '',
  };
}

function buildPropertyDetails(lot: SourcedParkingLocation): Record<string, string> {
  const ev =
    (lot.enrichment?.ev?.onSiteDcFastPorts ?? 0) > 0 ||
    (lot.enrichment?.ev?.onSiteLevel2Ports ?? 0) > 0
      ? 'yes'
      : '';
  return {
    owner: '',
    operator: sourceLabel(lot.source_name),
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
): Lead {
  const stage = deriveStage(lot, outreach);
  return {
    id: lot.id,
    raw: buildRaw(lot, outreach),
    stage,
    assignee: outreach?.assigned_to ?? 'Rinshin',
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
    property_details: buildPropertyDetails(lot),
    property_evidence: '',
    property_sources: lot.source_url ? { source: lot.source_url } : {},
  };
}