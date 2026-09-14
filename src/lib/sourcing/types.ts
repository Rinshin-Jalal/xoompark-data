// Types + pure identity/merge logic for the parking-lot sourcing pipeline.
// Deliberately Firestore-free (unlike store.ts) so computeDedupeKey and
// buildUpsertDoc can be unit-tested with plain `node`, no bundler, no
// 'server-only' guard tripping outside a server-component build.
import { slugifyCity } from '../citySlug.ts';
import { isInOdd } from '../odd/odd.ts';

export type FieldProvenanceValue = 'verified' | 'self-reported' | 'derived' | 'unknown';
export type SurfaceType = 'surface' | 'structured' | null;
export type GateType = 'manual' | 'automatic' | 'gateless' | 'lpr' | null;
export type CapturedBy = 'scraped' | 'bdr-captured' | 'admin' | 'phase2-walk';
export type SourcingStatus = 'draft' | 'saved';

/** Service tags for /search — AUTO-DERIVED from enrichment data (see
 * deriveServicesResources below), never manually tagged. */
export type ServiceTag = 'staging' | 'charging' | 'pudo' | 'wash' | 'service';
/** Resource tags for /search — same discipline as ServiceTag. */
export type ResourceTag = 'parking_stall' | 'ev_connector' | 'curb_berth' | 'wash_bay' | 'service_bay';

export interface SourceEvidence {
  source: string;
  url: string;
  seen_at: string; // ISO
  detail?: unknown;
}

export interface SourcedParkingLocation {
  // identity
  id: string;
  name: string;
  address?: string;
  normalized_address?: string;
  lat?: number;
  lng?: number;

  // lineage
  source_name: string;
  source_url: string;
  source_listing_id?: string;
  evidence: SourceEvidence[];

  // soft fields
  price_text?: string;
  hours_text?: string;
  capacity_text?: string;
  surface_type?: SurfaceType;
  gate_type?: GateType;
  clearance_text?: string;
  is_24_7?: boolean | null;
  is_fenced?: boolean | null;
  is_lit?: boolean | null;
  ingress_egress?: string | null;
  stall_count?: number | null;

  // provenance
  field_sources: Record<string, FieldProvenanceValue>;
  captured_by: CapturedBy;
  added_by?: string;
  claimed_by?: string;

  // lifecycle
  status: SourcingStatus;
  raw_input: unknown;
  notes?: string;
  created_at: string;
  updated_at: string;
  enriched_at?: string;
  merged_into_lot_id?: string;

  // operator (commercial parking manager)
  operator_id?: string | null;
  operator_source?: 'source' | 'name_pattern' | 'lbt' | 'manual' | null;

  // enrichment (computed from external sources, grouped)
  enrichment?: {
    geo?: {
      floodZone?: string | null;
      floodHazardArea?: boolean;
      residentialAdjacent?: boolean;
      checkedAt: string;
      demand?: {
        algorithm: string;
        schemaVersion: string;
        configHash: string;
        checkedAt: string;
        nearestZoneId: string;
        nearestZoneType: string;
        nearestDistanceMi: number;
        distancesMiByZoneId: Record<string, number>;
      };
    };
    ev?: {
      onSiteDcFastPorts?: number | null;
      onSiteLevel2Ports?: number | null;
      nearestDcFastMi?: number | null;
      nearestNetwork?: string | null;
      checkedAt: string;
    };
    amenities?: {
      nearestCarWashM?: number | null;
      nearestCarServiceM?: number | null;
      checkedAt: string;
    };
    pitstop?: {
      osmId?: string;
      osmType?: string | null;
      storageScore?: number;
      stagingScore?: number;
      capacity?: number | null;
      areaSqm?: number | null;
      ownerDirectCandidate?: boolean;
      owner?: string | null;
      checkedAt: string;
    };
    corporate_entity?: {
      entityName: string;
      documentNumber?: string;
      entityType?: string;
      status?: string;
      principalAddress?: string;
      registeredAgent?: string;
      authorizedPersons?: string[];
      lastAnnualReportFiled?: string;
      sourceUrl: string;
      checkedAt: string;
    };
    business_license?: {
      businessName: string;
      ownerName?: string;
      phone?: string;
      email?: string;
      businessAddress?: string;
      classCode?: string;
      classDesc?: string;
      accountStatus?: string;
      receiptYear?: number;
      folio: string;
      sourceUrl: string;
      checkedAt: string;
    };
    gate?: {
      claims: string[];
      derivedGateType?: GateType;
      sourceUrl: string;
      checkedAt: string;
    };
    parcel?: {
      folio: string;
      ownerOfRecord: string;
      ownerMailingAddress?: string;
      siteAddress?: string;
      dorCode?: string;
      dorDesc?: string;
      primaryZone?: string;
      lotSizeSqft?: number | null;
      matchMethod: 'point-in-polygon' | 'nearest';
      matchDistanceM?: number | null;
      ambiguous?: boolean;
      sourceUrl: string;
      checkedAt: string;
    };
  };

  // derived
  services?: ServiceTag[];
  resources?: ResourceTag[];
  derived_at?: string;
  locality?: string;
}

export function isInWaymoOdd(location: Pick<SourcedParkingLocation, 'lat' | 'lng'>): boolean | undefined {
  if (location.lat === undefined || location.lng === undefined) return undefined;
  return isInOdd(location.lat, location.lng, 'waymo');
}

/** Input to upsertSourcedLocation — one source's snapshot of a lot.
 * Deliberately camelCase (parser output shape), mapped to snake_case by
 * buildUpsertDoc. */
export interface SourcedLocationInput {
  name: string;
  address?: string;
  normalizedAddress?: string;
  lat?: number;
  lng?: number;

  source: string;
  sourceUrl: string;
  sourceListingId?: string;

  priceText?: string;
  hoursText?: string;
  capacityText?: string;
  surfaceType?: SurfaceType;
  gateType?: GateType;
  clearanceText?: string;
  access247?: boolean | null;
  fenced?: boolean | null;
  lit?: boolean | null;
  ingressEgress?: string | null;
  stallsTotal?: number | null;

  fieldProvenance?: Record<string, FieldProvenanceValue>;
  capturedBy: CapturedBy;
  addedBy?: string;
  rawInput: unknown;
  notes?: string;

  services?: ServiceTag[];
  resources?: ResourceTag[];
  locality?: string;
  evidenceDetail?: unknown;
}

export const SOFT_FIELDS = [
  'name', 'address', 'normalized_address', 'lat', 'lng',
  'price_text', 'hours_text', 'capacity_text', 'surface_type', 'gate_type', 'clearance_text',
  'is_24_7', 'is_fenced', 'is_lit', 'ingress_egress', 'stall_count',
] as const;
type SoftField = typeof SOFT_FIELDS[number];

export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(apt|apartment|unit|ste|suite|fl|floor)\.?\s*[\w-]*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTriState(v: unknown): boolean | null | undefined {
  if (v === true || v === false || v === null || v === undefined) return v;
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

export interface DedupeKeyInput {
  source: string;
  sourceListingId?: string;
  normalizedAddress?: string;
  address?: string;
}

export function computeDedupeKey(input: DedupeKeyInput): string {
  if (input.sourceListingId) return `${input.source}:${input.sourceListingId}`;
  const normalized = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : '');
  if (!normalized) throw new Error('computeDedupeKey: need a sourceListingId or an address');
  return `addr:${slugifyCity(normalized)}`.slice(0, 120);
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

const NON_VALUE_CLEARANCE = /no height restriction|not applicable|n\/a|unrestricted/i;

function stripClearanceIfSurface(doc: SourcedParkingLocation): SourcedParkingLocation {
  if (doc.surface_type !== 'surface' || !doc.clearance_text) return doc;
  const field_sources = { ...doc.field_sources };
  delete field_sources.clearance_text;
  return { ...doc, clearance_text: undefined, field_sources };
}

export function buildUpsertDoc(
  existing: SourcedParkingLocation | null,
  input: SourcedLocationInput,
  now: string,
): SourcedParkingLocation {
  if (input.clearanceText && NON_VALUE_CLEARANCE.test(input.clearanceText)) {
    input = { ...input, clearanceText: undefined };
  }
  const normalizedAddress = input.normalizedAddress
    ?? (input.address ? normalizeAddress(input.address) : undefined);
  const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
  const evidenceEntry: SourceEvidence = { source: input.source, url: input.sourceUrl, seen_at: now };
  if (input.evidenceDetail !== undefined) evidenceEntry.detail = input.evidenceDetail;

  if (!existing) {
    return stripClearanceIfSurface({
      id,
      name: input.name,
      address: input.address,
      normalized_address: normalizedAddress,
      lat: input.lat,
      lng: input.lng,
      source_name: input.source,
      source_url: input.sourceUrl,
      source_listing_id: input.sourceListingId,
      evidence: [evidenceEntry],
      price_text: input.priceText,
      hours_text: input.hoursText,
      capacity_text: input.capacityText,
      surface_type: input.surfaceType ?? null,
      gate_type: input.gateType ?? null,
      clearance_text: input.clearanceText,
      is_24_7: input.access247,
      is_fenced: input.fenced,
      is_lit: input.lit,
      ingress_egress: input.ingressEgress,
      stall_count: input.stallsTotal,
      field_sources: input.fieldProvenance ?? {},
      captured_by: input.capturedBy,
      added_by: input.addedBy,
      status: 'draft',
      raw_input: input.rawInput,
      notes: input.notes,
      services: input.services,
      resources: input.resources,
      created_at: now,
      updated_at: now,
    });
  }

  const merged: SourcedParkingLocation = { ...existing };
  const notesParts = existing.notes ? [existing.notes] : [];

  const existingEvidenceIdx = existing.evidence.findIndex((e) => e.source === input.source);
  merged.evidence = existingEvidenceIdx === -1
    ? [...existing.evidence, evidenceEntry]
    : existing.evidence.map((e, i) => (i === existingEvidenceIdx ? { ...e, ...evidenceEntry } : e));

  const incomingValues: Record<SoftField, unknown> = {
    name: input.name,
    address: input.address,
    normalized_address: normalizedAddress,
    lat: input.lat,
    lng: input.lng,
    price_text: input.priceText,
    hours_text: input.hoursText,
    capacity_text: input.capacityText,
    surface_type: input.surfaceType,
    gate_type: input.gateType,
    clearance_text: input.clearanceText,
    is_24_7: input.access247,
    is_fenced: input.fenced,
    is_lit: input.lit,
    ingress_egress: input.ingressEgress,
    stall_count: input.stallsTotal,
  };

  const provenance = { ...existing.field_sources };
  const existingRec = existing as unknown as Record<string, unknown>;
  const mergedRec = merged as unknown as Record<string, unknown>;

  for (const field of SOFT_FIELDS) {
    const incoming = incomingValues[field];
    if (isEmpty(incoming)) continue;
    const current = existingRec[field];
    if (isEmpty(current)) {
      mergedRec[field] = incoming;
      provenance[field] = input.fieldProvenance?.[field] ?? 'unknown';
    } else if (current !== incoming) {
      notesParts.push(`conflict:${field}:${current}|${incoming}`);
    }
  }

  merged.field_sources = provenance;
  merged.notes = notesParts.length ? notesParts.join('; ') : undefined;
  merged.updated_at = now;
  return stripClearanceIfSurface(merged);
}

// --- Outreach tracking (subcollection per lot) ---

export const OUTREACH_STATES = ['ready', 'sent', 'called', 'responded', 'quoted'] as const;
export type OutreachState = (typeof OUTREACH_STATES)[number];

export const OUTREACH_STATE_LABELS: Record<OutreachState, string> = {
  ready: 'Ready',
  sent: 'Sent',
  called: 'Called',
  responded: 'Responded',
  quoted: 'Quoted',
};

export interface OutreachRecord {
  id: string;
  lot_id: string;
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_phone: string;
  email_sent: boolean;
  call_completed: boolean;
  form_submitted: boolean;
  offered_spaces: number | null;
  offered_price: string;
  offered_start_date: string;
  status: OutreachState;
  response_date: string | null;
  quote_source: string;
  assigned_to: string;
  created_at: string;
  updated_at: string;
}

// --- Commercial offers (pricing + terms, subcollection per lot) ---
// Offers are first-class: outreach activities generate offers, offers drive
// qualification. Store numeric rate + raw text; derive tiers in the UI.

export const OFFER_SOURCES = ['email', 'call', 'meeting'] as const;
export type OfferSource = (typeof OFFER_SOURCES)[number];

export const OFFER_STATUSES = ['indicative', 'quoted', 'negotiating', 'final'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const PRICING_MODELS = ['per_stall_monthly', 'per_lot_monthly', 'revenue_share', 'custom'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const OFFER_SOURCE_LABELS: Record<OfferSource, string> = {
  email: 'Email',
  call: 'Call',
  meeting: 'Meeting',
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  indicative: 'Indicative',
  quoted: 'Quoted',
  negotiating: 'Negotiating',
  final: 'Final',
};

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  per_stall_monthly: 'Per stall / mo',
  per_lot_monthly: 'Per lot / mo',
  revenue_share: 'Revenue share',
  custom: 'Custom',
};

export const TERM_TYPES = ['month_to_month', 'fixed', 'trial', 'unknown'] as const;
export type TermType = (typeof TERM_TYPES)[number];

export const TERM_TYPE_LABELS: Record<TermType, string> = {
  month_to_month: 'Month-to-month',
  fixed: 'Fixed term',
  trial: 'Trial',
  unknown: 'Unknown',
};

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

// $5/$10/$20 are internal target bands, not the only allowed values. Store the
// numeric rate; derive the band for routing/reporting.
export function rateTier(rate: number | null): 'low_5' | 'mid_10' | 'high_20' | 'custom' | 'unknown' {
  if (rate == null) return 'unknown';
  if (rate <= 7.5) return 'low_5';
  if (rate <= 15) return 'mid_10';
  if (rate <= 30) return 'high_20';
  return 'custom';
}

export const RATE_TIER_LABELS: Record<ReturnType<typeof rateTier>, string> = {
  low_5: '$5 band',
  mid_10: '$10 band',
  high_20: '$20 band',
  custom: 'Custom',
  unknown: 'Unknown',
};

export interface CommercialOffer {
  id: string;
  lot_id: string;
  source: OfferSource;
  captured_by: string;
  status: OfferStatus;
  pricing_model: PricingModel;
  currency: string;
  monthly_rate_per_stall: number | null;
  minimum_spaces: number | null;
  term_months: number | null;
  term_type: TermType;
  cancellation_notice_days: number | null;
  start_date: string | null;
  confidence: Confidence;
  needs_human_review: boolean;
  notes: string;
  raw_source_text: string;
  created_at: string;
}

// --- Auto-derived services/resources ---

const HOURS_247_RE = /24\s*\/\s*7|open\s+24|24\s*hours/i;
function parseCapacityForDerivation(text?: string): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export const STAGING_MIN_CAPACITY = 100;
export const WASH_NEAR_M = 200;
export const SERVICE_NEAR_M = 200;

export function deriveServicesResources(
  loc: Pick<SourcedParkingLocation, 'enrichment' | 'stall_count' | 'capacity_text' | 'is_24_7' | 'hours_text' | 'is_fenced'>,
): { services: ServiceTag[]; resources: ResourceTag[] } {
  const services: ServiceTag[] = [];
  const resources: ResourceTag[] = ['parking_stall'];

  if ((loc.enrichment?.ev?.onSiteDcFastPorts ?? 0) > 0 || (loc.enrichment?.ev?.onSiteLevel2Ports ?? 0) > 0) {
    services.push('charging');
    resources.push('ev_connector');
  }

  if (loc.enrichment?.amenities?.nearestCarWashM != null && loc.enrichment.amenities.nearestCarWashM <= WASH_NEAR_M) {
    services.push('wash');
    resources.push('wash_bay');
  }

  if (loc.enrichment?.amenities?.nearestCarServiceM != null && loc.enrichment.amenities.nearestCarServiceM <= SERVICE_NEAR_M) {
    services.push('service');
    resources.push('service_bay');
  }

  const capacity = loc.stall_count
    ?? parseCapacityForDerivation(loc.capacity_text)
    ?? loc.enrichment?.pitstop?.capacity
    ?? null;
  const open247 = loc.is_24_7 === true || HOURS_247_RE.test(loc.hours_text ?? '');
  if (capacity !== null && capacity >= STAGING_MIN_CAPACITY && open247 && loc.is_fenced === true) {
    services.push('staging');
  }

  return { services, resources };
}

// --- Cross-source merge ---

export interface AdminUser {
  uid: string;
  email: string;
  name: string;
}

export interface MergeResult {
  mergedPrimary: SourcedParkingLocation;
  markedSecondary: SourcedParkingLocation;
}

function toMergeInput(doc: SourcedParkingLocation): SourcedLocationInput {
  const verifiedProvenance: Record<string, FieldProvenanceValue> = {};
  for (const field of SOFT_FIELDS) verifiedProvenance[field] = 'verified';
  return {
    name: doc.name,
    address: doc.address,
    normalizedAddress: doc.normalized_address,
    lat: doc.lat,
    lng: doc.lng,
    source: doc.source_name,
    sourceUrl: doc.source_url,
    sourceListingId: doc.source_listing_id,
    priceText: doc.price_text,
    hoursText: doc.hours_text,
    capacityText: doc.capacity_text,
    surfaceType: doc.surface_type,
    clearanceText: doc.clearance_text,
    gateType: doc.gate_type,
    access247: doc.is_24_7,
    fenced: doc.is_fenced,
    lit: doc.is_lit,
    ingressEgress: doc.ingress_egress,
    stallsTotal: doc.stall_count,
    fieldProvenance: verifiedProvenance,
    capturedBy: doc.captured_by,
    rawInput: doc.raw_input,
    notes: doc.notes,
  };
}

export function mergeSourcedLocationsPure(
  primary: SourcedParkingLocation,
  secondary: SourcedParkingLocation,
  adminUser: AdminUser,
  now: string,
): MergeResult {
  if (primary.id === secondary.id) {
    throw new Error('mergeSourcedLocationsPure: cannot merge a record into itself');
  }
  if (secondary.merged_into_lot_id) {
    throw new Error(
      `mergeSourcedLocationsPure: secondary ${secondary.id} is already merged into ${secondary.merged_into_lot_id}`,
    );
  }

  const mergedPrimary = buildUpsertDoc(primary, toMergeInput(secondary), now);
  mergedPrimary.captured_by = 'admin';

  const mergeNote = `merged:${secondary.id}<-by:${adminUser.email || adminUser.uid}`;
  mergedPrimary.notes = mergedPrimary.notes ? `${mergedPrimary.notes}; ${mergeNote}` : mergeNote;

  const markedSecondary: SourcedParkingLocation = { ...secondary, merged_into_lot_id: primary.id };

  return { mergedPrimary, markedSecondary };
}