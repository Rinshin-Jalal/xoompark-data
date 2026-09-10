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
  seenAt: string; // ISO
  /**
   * Optional trimmed snapshot of a richer per-source payload (e.g. the
   * SpotHero facility-detail page's parsed fields for the enrichment tier).
   * Deliberately not the full raw page — see enrichSpothero.ts for what it
   * actually stores and why. rawInput stays the source of truth for the
   * original ingest; this is supplementary, evidence-trail-only context.
   */
  detail?: unknown;
}

export interface SourcedParkingLocation {
  // identity
  id: string;
  name: string;
  address?: string;
  normalizedAddress?: string;
  lat?: number;
  lng?: number;

  // lineage
  source: string;
  sourceUrl: string;
  sourceListingId?: string;
  evidence: SourceEvidence[];

  // soft fields
  priceText?: string;
  hoursText?: string;
  capacityText?: string;
  surfaceType?: SurfaceType;
  gateType?: GateType;
  clearanceText?: string;
  /** Three-state discipline: true/false ONLY when a source affirmatively
   * states it; undefined = no info yet (renders unknown); null = checked,
   * couldn't tell. */
  access247?: boolean | null;
  fenced?: boolean | null;
  lit?: boolean | null;
  ingressEgress?: string | null;
  stallsTotal?: number | null;

  // provenance — three states, never two
  fieldProvenance: Record<string, FieldProvenanceValue>;
  capturedBy: CapturedBy;

  /** Free-text name of the person who manually entered this record (the +
   * Add Location form) — there's no BDR login in this tool, so this is
   * self-reported, not authenticated. Set once at creation, like capturedBy;
   * never touched by buildUpsertDoc's merge path. */
  addedBy?: string;

  /** Free-text name of whoever is currently working this record in the BDR
   * Work Queue — deliberately separate from addedBy: one person can add a
   * lot (via Hunt/+Add Location) and a different person can later pick it
   * up and work its checklist fields in the queue. Editable any time
   * (direct update via actions.ts, same as notes), unlike addedBy. */
  claimedBy?: string;

  // lifecycle
  status: SourcingStatus;
  rawInput: unknown;
  notes?: string;
  createdAt: string;
  updatedAt: string;

  /** ISO timestamp set once the facility-detail enrichment tier has run for
   * this record (see enrichSpothero.ts). Bookkeeping/pipeline-stage marker,
   * not scraped content — deliberately NOT in SOFT_FIELDS, set via a direct
   * store update rather than buildUpsertDoc's fill-empty/conflict machinery. */
  enrichedAt?: string;

  /** Set when this doc was folded into another via mergeSourcedLocations — the
   * primary's id. Never deleted; a merged doc keeps all its own data. */
  mergedInto?: string;

  /** COMPUTED context from external geo APIs (FEMA NFHL flood zone, OSM
   * residential-adjacency) — not source-provided, so deliberately NOT in
   * SOFT_FIELDS and never touched by buildUpsertDoc's fill-empty/conflict
   * machinery. Set via a direct store update (setGeoContext in store.ts),
   * same pattern as enrichedAt above. See geoContext.ts. */
  geoContext?: {
    floodZone?: string | null; // FEMA zone letter, null = checked & clean
    floodHazardArea?: boolean; // in Special Flood Hazard Area
    residentialAdjacent?: boolean; // residential feature within 150m
    checkedAt: string; // ISO
    /** COMPUTED demand-zone distances (see demandEnrich.ts) — same discipline
     * as the fields above: not source-provided, set via direct dot-path
     * update (setDemandContext in store.ts) so existing flood/residential
     * fields are never clobbered. Stores full-precision haversine miles;
     * round only at presentation. No weighted score is persisted (Greg's
     * rule: suitability scores are computed per use case, never stored). */
    demand?: {
      algorithm: string; // "haversine-geodesic-air-miles"
      schemaVersion: string; // "demand-zones-miami-v1"
      configHash: string; // stable hash of zone config — change triggers re-enrich
      checkedAt: string; // ISO
      nearestZoneId: string;
      nearestZoneType: string; // DemandZoneType
      nearestDistanceMi: number; // full precision
      distancesMiByZoneId: Record<string, number>;
    };
  };

  /** COMPUTED context from AFDC/NLR charging-station data (see
   * scripts/enrich-ev-pitstop.ts) — same discipline as geoContext:
   * not source-provided, not in SOFT_FIELDS, set via direct store update. */
  evContext?: {
    /** Sum of DC-fast ports across AFDC stations within ~100m of the lot
     * (same parcel). null = checked, none on-site. */
    onSiteDcFastPorts?: number | null;
    /** Sum of Level 2 ports across AFDC stations within ~100m — overnight
     * fleet charging counts. null = checked, none on-site. */
    onSiteLevel2Ports?: number | null;
    nearestDcFastMi?: number | null;
    nearestNetwork?: string | null;
    checkedAt: string; // ISO
  };

  /** COMPUTED context from OSM car-wash / car-repair proximity (see
   * scripts/enrich-ev-pitstop.ts) — same discipline as evContext. Distances
   * are meters to the nearest amenity in the Miami bbox; null = checked,
   * none in the bbox. */
  amenityContext?: {
    nearestCarWashM?: number | null;
    nearestCarServiceM?: number | null;
    checkedAt: string; // ISO
  };

  /** COMPUTED cross-reference to the pitstop-finder's pitstop_findings (matched
   * by lat/lng proximity, ≤75m) — same discipline as geoContext. */
  pitstopContext?: {
    osmId?: string;
    /** OSM parking type, mapped: surface → 'surface', multi-storey/
     * underground → 'structured', else raw tag. */
    osmType?: string | null;
    storageScore?: number;
    stagingScore?: number;
    capacity?: number | null;
    areaSqm?: number | null;
    ownerDirectCandidate?: boolean;
    owner?: string | null;
    checkedAt: string; // ISO
  };

  /** COMPUTED from Florida Sunbiz corporate registry (see entityContext.ts)
   * — the state filing for the parcel's owner-of-record entity: officers/
   * managers, registered agent, principal address, status, filing recency.
   * Deliberately stops at entity connections: a registered agent is often a
   * filing service (CT Corporation), and an officer is not automatically
   * the person who can approve a fleet deal. Same discipline as geoContext:
   * direct store update, outside SOFT_FIELDS. */
  entityContext?: {
    entityName: string;
    documentNumber?: string;
    /** Sunbiz entity type — 'Foreign Limited Liability Company' etc. */
    entityType?: string;
    /** ACTIVE / INACT. */
    status?: string;
    principalAddress?: string;
    registeredAgent?: string;
    /** Authorized persons (officers/managers) with titles, verbatim. */
    authorizedPersons?: string[];
    /** Last annual-report filed date — the staleness check. */
    lastAnnualReportFiled?: string;
    sourceUrl: string;
    checkedAt: string; // ISO
  };

  /** COMPUTED from Miami-Dade Local Business Tax receipts (LBT layer 23,
   * see lbtContext.ts) — the business actually operating at the lot's
   * parcel, joined via parcelContext.folio. Deliberately only
   * parking-named businesses (PARKING/VALET/GARAGE in BUSNAME): a parcel's
   * ground-floor tenants (restaurants, salons) hold LBT receipts too and
   * must never be mistaken for the lot's operator. Same discipline as
   * geoContext: direct store update, outside SOFT_FIELDS. */
  lbtContext?: {
    businessName: string;
    ownerName?: string;
    phone?: string;
    email?: string;
    businessAddress?: string;
    classCode?: string;
    classDesc?: string;
    accountStatus?: string;
    receiptYear?: number;
    /** Dashed folio exactly as LBT stores it (XX-XXXX-XXX-XXXX). */
    folio: string;
    sourceUrl: string;
    checkedAt: string; // ISO
  };

  /** COMPUTED from SpotHero facility-page redemption instructions and
   * amenities (see gateEvidence.ts) — verbatim gate-behaviour claims
   * ("Our cameras will recognize your license plate") plus a derivedGateType
   * ONLY when the text is explicit (camera/plate recognition -> lpr).
   * Claims are listing evidence, never verified physical fact — a human
   * confirms before anything here touches gateType proper. Same discipline
   * as geoContext: direct store update, outside SOFT_FIELDS. */
  gateEvidence?: {
    /** Verbatim sentences from the listing — the audit trail. */
    claims: string[];
    /** Only 'lpr' today — the one claim vocabulary explicit enough to
     * normalize. Everything else stays a claim. */
    derivedGateType?: GateType;
    sourceUrl: string;
    checkedAt: string; // ISO
  };

  /** Price observations over time — every time a source reports a priceText
   * that differs from the current one, the observation appends here (never
   * overwrites; the current priceText stays authoritative). Wayback backfill
   * was investigated and is NOT viable: SpotHero's archived pages are JS
   * hydration shells with no price in the static HTML (checked 2024 + 2026
   * snapshots, 2026-09-08) — so history starts from our own re-scrapes. */
  priceHistory?: Array<{ seenAt: string; priceText: string; sourceUrl: string }>;

  /** COMPUTED from Miami-Dade Property Appraiser GIS (MD_LandInformation
   * ArcGIS layers — see parcelContext.ts) — the county parcel record for the
   * lot's location. The folio is the canonical join key for all future
   * county enrichment (permits, deeds, zoning, LBT). Same discipline as
   * geoContext: not source-provided, not in SOFT_FIELDS, set via direct
   * store update. ownerOfRecord is the TAX OWNER (landowner) — deliberately
   * a different thing from ownerOperator (who runs the lot). */
  parcelContext?: {
    folio: string;
    ownerOfRecord: string;
    ownerMailingAddress?: string;
    siteAddress?: string;
    dorCode?: string;
    dorDesc?: string;
    primaryZone?: string;
    lotSizeSqft?: number | null;
    /** How the parcel was matched — point-in-polygon on the parcel layer, or
     * nearest non-condo property point (listing coords often sit on the
     * street/right-of-way, outside the parcel polygon). */
    matchMethod: 'point-in-polygon' | 'nearest';
    /** Distance from our coordinate to the matched property point, metres —
     * null for point-in-polygon (the point was inside the polygon). */
    matchDistanceM?: number | null;
    /** True when the nearest-match was far (>40m) or a coin-flip between
     * two different owners — human should review before trusting. */
    ambiguous?: boolean;
    /** Exact ArcGIS REST query URL that produced this — the audit trail. */
    sourceUrl: string;
    checkedAt: string; // ISO
  };

  /** AUTO-DERIVED service/resource tags (see deriveServicesResources below +
   * servicesEnrich.ts) — computed from enrichment data we already have
   * (evContext, pitstopContext, capacity/hours/fence), never manually
   * tagged and never fed through buildUpsertDoc's soft-field merge.
   * Absent/empty = unknown, never guessed. derivedAt stamps the last
   * derivation pass; the pass is idempotent (recompute overwrites in place). */
  services?: ServiceTag[];
  resources?: ResourceTag[];
  derivedAt?: string;

  /** COMPUTED from the address via deriveLocality (see locality.ts) — one of
   * the 12 canonical Miami localities in docs/bdr-workflow.md §0.5, or
   * absent when nothing matched (or ambiguous). Not source-provided, so
   * deliberately NOT in SOFT_FIELDS and never touched by buildUpsertDoc's
   * fill-empty/conflict machinery — same pattern as geoContext/enrichedAt
   * above. Set via a direct store update (setLocality in store.ts) on
   * create only; never overwritten by a later merge. */
  locality?: string;
}

/**
 * Live Waymo-ODD check, computed from lat/lng — deliberately NOT a stored
 * field. A stored mirror needs a write-time recompute hook, a backfill for
 * every pre-existing record, and drifts if the check logic ever changes;
 * this is a cheap pure function of fields already on the doc, so there's
 * nothing to keep in sync or backfill (same "just derive it" approach
 * ChargingSitesClient.tsx already uses for the identical fleet-ODD check).
 * undefined = no lat/lng yet to check, distinct from a confirmed false.
 */
export function isInWaymoOdd(location: Pick<SourcedParkingLocation, 'lat' | 'lng'>): boolean | undefined {
  if (location.lat === undefined || location.lng === undefined) return undefined;
  return isInOdd(location.lat, location.lng, 'waymo');
}

/** Input to upsertSourcedLocation — one source's snapshot of a lot. */
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

  /** Derived service/resource tags — pass-through on create only; the
   * merge path never touches them (enrichment-pipeline-owned, like
   * geoContext/evContext). */
  services?: ServiceTag[];
  resources?: ResourceTag[];

  /** Explicit locality, when the caller already knows it (e.g. the Hunt
   * tracker's "+ Add Location" — the BDR picked a locality before ever
   * opening the form). Takes priority over deriveLocality(address) on
   * create — see upsertSourcedLocation in store.ts — since address text
   * only contains the neighborhood name by coincidence for most real
   * addresses ("3401 N Miami Ave" never says "Midtown"), while the BDR's
   * own selection is always right. */
  locality?: string;

  /** Optional supplementary payload attached to this call's evidence entry
   * (see SourceEvidence.detail). Not a soft field — never fed through the
   * fill-empty/conflict merge loop. */
  evidenceDetail?: unknown;
}

export const SOFT_FIELDS = [
  'name', 'address', 'normalizedAddress', 'lat', 'lng',
  'priceText', 'hoursText', 'capacityText', 'surfaceType', 'gateType', 'clearanceText',
  'access247', 'fenced', 'lit', 'ingressEgress', 'stallsTotal',
] as const;
type SoftField = typeof SOFT_FIELDS[number];

/** Lowercase, strip punctuation and common unit/apt/suite markers. */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(apt|apartment|unit|ste|suite|fl|floor)\.?\s*[\w-]*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read-time normalizer for the tri-state boolean fields (access247/fenced/
 * lit). Legacy docs (pre-tri-state-discipline imports) stored 'yes'/'no'/
 * 'unknown' strings; anything that isn't a real boolean/null/undefined maps
 * to undefined ("no info") except the known legacy strings. Applied by the
 * store on every read so every consumer — admin tables, BDR queue, fleet
 * API — sees clean tri-state data without a Firestore backfill.
 * // ponytail: read-time coercion, not a backfill; if the legacy docs are
 * // ever rewritten anyway, this becomes a no-op.
 */
export function normalizeTriState(v: unknown): boolean | null | undefined {
  if (v === true || v === false || v === null || v === undefined) return v;
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined; // 'unknown' or any other legacy string = no info
}

export interface DedupeKeyInput {
  source: string;
  sourceListingId?: string;
  normalizedAddress?: string;
  address?: string;
}

/**
 * Standardized dedupe key / doc id: `${source}:${sourceListingId}` when we
 * have a listing id, else `addr:${slugified normalizedAddress}`.
 */
export function computeDedupeKey(input: DedupeKeyInput): string {
  if (input.sourceListingId) return `${input.source}:${input.sourceListingId}`;
  const normalized = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : '');
  if (!normalized) throw new Error('computeDedupeKey: need a sourceListingId or an address');
  return `addr:${slugifyCity(normalized)}`.slice(0, 120);
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

// A clearance "value" that says there ISN'T one — "No height restrictions",
// "N/A (surface lot)", "Not applicable" — is not data; storing it makes
// surface lots look like they have clearances (fixed retroactively in
// scripts/fix-clearance-rule1.mjs). Guarded here so no future scrape can
// reintroduce the pattern: this is the one merge path every adapter's
// upsert flows through.
const NON_VALUE_CLEARANCE = /no height restriction|not applicable|n\/a|unrestricted/i;

/**
 * A surface lot has no overhead structure, so a clearance is physically
 * impossible — a wrong clearance number fed to the fleet API can damage a
 * vehicle. Whichever side of a merge claims 'surface', clearance loses:
 * a surface lot with no clearance is honest, one with a bogus clearance is
 * dangerous. Applied to every doc buildUpsertDoc returns (create AND merge,
 * so legacy bad docs self-heal on the next upsert). Retro-fix for the 21
 * flagged prod records: scripts/fix_surface_clearance.ts.
 */
function stripClearanceIfSurface(doc: SourcedParkingLocation): SourcedParkingLocation {
  if (doc.surfaceType !== 'surface' || !doc.clearanceText) return doc;
  const fieldProvenance = { ...doc.fieldProvenance };
  delete fieldProvenance.clearanceText;
  return { ...doc, clearanceText: undefined, fieldProvenance };
}

/**
 * Pure merge decision: given the existing doc (or null) and an incoming
 * source snapshot, produce the doc to write. No Firestore involved, so
 * store.ts's upsertSourcedLocation is a thin wrapper around this.
 *
 * Rules (Brad's): never blindly overwrite. New doc starts as draft. On
 * merge — fill empty fields, keep existing on conflict and record the
 * conflict visibly in notes, add the source to evidence once.
 */
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
  const evidenceEntry: SourceEvidence = { source: input.source, url: input.sourceUrl, seenAt: now };
  if (input.evidenceDetail !== undefined) evidenceEntry.detail = input.evidenceDetail;

  if (!existing) {
    return stripClearanceIfSurface({
      id,
      name: input.name,
      address: input.address,
      normalizedAddress,
      lat: input.lat,
      lng: input.lng,
      source: input.source,
      sourceUrl: input.sourceUrl,
      sourceListingId: input.sourceListingId,
      evidence: [evidenceEntry],
      priceText: input.priceText,
      hoursText: input.hoursText,
      capacityText: input.capacityText,
      surfaceType: input.surfaceType ?? null,
      gateType: input.gateType ?? null,
      clearanceText: input.clearanceText,
      // ponytail: pass-through, NOT `?? null` like surfaceType above — for
      // these, undefined (untouched) and null (checked, couldn't tell) are
      // different states; only the source's actual value may write null.
      access247: input.access247,
      fenced: input.fenced,
      lit: input.lit,
      ingressEgress: input.ingressEgress,
      stallsTotal: input.stallsTotal,
      fieldProvenance: input.fieldProvenance ?? {},
      capturedBy: input.capturedBy,
      addedBy: input.addedBy,
      status: 'draft',
      rawInput: input.rawInput,
      notes: input.notes,
      services: input.services,
      resources: input.resources,
      createdAt: now,
      updatedAt: now,
      // seed the lineage — the first price is an observation too
      priceHistory: input.priceText
        ? [{ seenAt: now, priceText: input.priceText, sourceUrl: input.sourceUrl }]
        : undefined,
    });
  }

  const merged: SourcedParkingLocation = { ...existing };
  const notesParts = existing.notes ? [existing.notes] : [];

  // Same source revisiting (e.g. the SpotHero facility-detail enrichment
  // pass re-upserting under the same 'spothero' source the city-page tier
  // already recorded) updates that source's existing evidence entry in
  // place (fresh seenAt, and evidenceDetail merged in if provided) instead
  // of being a no-op — otherwise a later, richer evidenceDetail could never
  // reach the evidence trail once the source was already seen once.
  const existingEvidenceIdx = existing.evidence.findIndex((e) => e.source === input.source);
  merged.evidence = existingEvidenceIdx === -1
    ? [...existing.evidence, evidenceEntry]
    : existing.evidence.map((e, i) => (i === existingEvidenceIdx ? { ...e, ...evidenceEntry } : e));

  const incomingValues: Record<SoftField, unknown> = {
    name: input.name,
    address: input.address,
    normalizedAddress,
    lat: input.lat,
    lng: input.lng,
    priceText: input.priceText,
    hoursText: input.hoursText,
    capacityText: input.capacityText,
    surfaceType: input.surfaceType,
    gateType: input.gateType,
    clearanceText: input.clearanceText,
    access247: input.access247,
    fenced: input.fenced,
    lit: input.lit,
    ingressEgress: input.ingressEgress,
    stallsTotal: input.stallsTotal,
  };

  const provenance = { ...existing.fieldProvenance };
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

  // A differing incoming priceText is a real observation from a source at
  // time `now` — append it to priceHistory rather than losing it to the
  // conflict note. The current priceText stays authoritative (never
  // overwritten, same as every other soft field). Truthiness check (not
  // isEmpty) so TypeScript narrows priceText to string for the entry.
  const incomingPrice = input.priceText;
  if (incomingPrice && incomingPrice !== existing.priceText) {
    merged.priceHistory = [
      ...(existing.priceHistory ?? []),
      { seenAt: now, priceText: incomingPrice, sourceUrl: input.sourceUrl },
    ];
  }

  merged.fieldProvenance = provenance;
  merged.notes = notesParts.length ? notesParts.join('; ') : undefined;
  merged.updatedAt = now;
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
  lotId: string;
  // contact
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  // inquiry
  inquirySent: boolean;
  callMade: boolean;
  formSubmitted: boolean;
  // offer
  offerSpaces: number | null;
  offerPrice: string;
  offerStart: string;
  // state machine
  outreachState: OutreachState;
  responseDate: string | null;
  quoteSource: string;
  bdrOwner: string;
  // timestamps
  createdAt: string;
  updatedAt: string;
}

// --- Auto-derived services/resources (see SourcedParkingLocation.services) ---

// ponytail: 4-line duplicates of publicNetwork's parseCapacityText /
// hoursImply247 — importing that module drags firebase-admin into this
// pure file's import graph; move both to a shared util if a third consumer appears.
const HOURS_247_RE = /24\s*\/\s*7|open\s+24|24\s*hours/i;
function parseCapacityForDerivation(text?: string): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Staging heuristic threshold — capacity ≥ this + 24/7 + fenced ⇒ staging.
 * Tunable knob, not a law: 100 stalls is a defensible "big lot" for AV
 * staging; raise/lower after watching what the filter actually admits. */
export const STAGING_MIN_CAPACITY = 100;

/** How near an OSM car wash / car-repair shop must be to count as a wash /
 * service option for the lot. Tunable: 200m ≈ 2 blocks — usable for a fleet
 * without claiming the amenity is on-parcel. */
export const WASH_NEAR_M = 200;
export const SERVICE_NEAR_M = 200;

/**
 * Pure derivation of service/resource tags from enrichment data already on
 * the doc — the /search Services/Resources categories' only write path.
 * Rules (absent/empty = unknown, never guessed):
 *   resources: ['parking_stall'] — trivially true for every lot
 *   charging + ev_connector — evContext: DC-fast OR Level 2 ports on-site
 *     (the EV proximity enrichment already decided "on-site or within
 *     threshold": it counts ports within ~100m, same parcel)
 *   staging — heuristic: capacity ≥ STAGING_MIN_CAPACITY + 24/7 + fenced
 *     (provenance 'derived', not verified)
 *   wash + wash_bay — amenityContext: car wash within WASH_NEAR_M
 *   service + service_bay — amenityContext: car repair within SERVICE_NEAR_M
 *   pudo — no honest signal in the data we have (curb/venue proximity not
 *     stored) — absent, never guessed; add when an enrichment captures it.
 */
export function deriveServicesResources(
  loc: Pick<SourcedParkingLocation, 'evContext' | 'amenityContext' | 'pitstopContext' | 'stallsTotal' | 'capacityText' | 'access247' | 'hoursText' | 'fenced'>,
): { services: ServiceTag[]; resources: ResourceTag[] } {
  const services: ServiceTag[] = [];
  const resources: ResourceTag[] = ['parking_stall'];

  if ((loc.evContext?.onSiteDcFastPorts ?? 0) > 0 || (loc.evContext?.onSiteLevel2Ports ?? 0) > 0) {
    services.push('charging');
    resources.push('ev_connector');
  }

  if (loc.amenityContext?.nearestCarWashM != null && loc.amenityContext.nearestCarWashM <= WASH_NEAR_M) {
    services.push('wash');
    resources.push('wash_bay');
  }

  if (loc.amenityContext?.nearestCarServiceM != null && loc.amenityContext.nearestCarServiceM <= SERVICE_NEAR_M) {
    services.push('service');
    resources.push('service_bay');
  }

  const capacity = loc.stallsTotal
    ?? parseCapacityForDerivation(loc.capacityText)
    ?? loc.pitstopContext?.capacity
    ?? null;
  // Same 24/7 read as the public projection: explicit access247, else
  // affirmative hoursText ("Open 24/7") — never a guess from silence.
  const open247 = loc.access247 === true || HOURS_247_RE.test(loc.hoursText ?? '');
  if (capacity !== null && capacity >= STAGING_MIN_CAPACITY && open247 && loc.fenced === true) {
    services.push('staging');
  }

  return { services, resources };
}

// --- Cross-source merge (admin-approved, two existing docs) ----------------

export interface AdminUser {
  uid: string;
  email: string;
  name: string;
}

export interface MergeResult {
  mergedPrimary: SourcedParkingLocation;
  markedSecondary: SourcedParkingLocation;
}

/**
 * Adapt an existing doc into buildUpsertDoc's SourcedLocationInput shape so
 * the merge path can reuse buildUpsertDoc's fill-empty/conflict-log logic
 * instead of duplicating it. fieldProvenance is forced to 'verified' on every
 * soft field — a human approved this merge, so whatever ends up filled on the
 * primary counts as verified (buildUpsertDoc only reads this map for fields
 * it actually fills, so forcing it for the rest is harmless).
 */
function toMergeInput(doc: SourcedParkingLocation): SourcedLocationInput {
  const verifiedProvenance: Record<string, FieldProvenanceValue> = {};
  for (const field of SOFT_FIELDS) verifiedProvenance[field] = 'verified';
  return {
    name: doc.name,
    address: doc.address,
    normalizedAddress: doc.normalizedAddress,
    lat: doc.lat,
    lng: doc.lng,
    source: doc.source,
    sourceUrl: doc.sourceUrl,
    sourceListingId: doc.sourceListingId,
    priceText: doc.priceText,
    hoursText: doc.hoursText,
    capacityText: doc.capacityText,
    surfaceType: doc.surfaceType,
    clearanceText: doc.clearanceText,
    gateType: doc.gateType,
    access247: doc.access247,
    fenced: doc.fenced,
    lit: doc.lit,
    ingressEgress: doc.ingressEgress,
    stallsTotal: doc.stallsTotal,
    fieldProvenance: verifiedProvenance,
    capturedBy: doc.capturedBy,
    rawInput: doc.rawInput,
    notes: doc.notes,
  };
}

/**
 * Pure merge decision for folding one existing doc (secondary) into another
 * (primary) — no Firestore involved, so store.ts's mergeSourcedLocations is a
 * thin load/write wrapper around this, same split as buildUpsertDoc vs
 * upsertSourcedLocation above.
 *
 * Reuses buildUpsertDoc for the actual field-merge (fill-empty, conflict-log,
 * evidence-add-once) rather than reimplementing it by hand — buildUpsertDoc
 * is built for existing-doc + new-input-snapshot, and toMergeInput adapts the
 * secondary doc into that snapshot shape so the same rules apply here.
 *
 * Throws if primaryId === secondaryId or if secondary is already merged —
 * merging an already-merged secondary a second time could let it end up
 * pointing at two different primaries, which the caller must never allow.
 */
export function mergeSourcedLocationsPure(
  primary: SourcedParkingLocation,
  secondary: SourcedParkingLocation,
  adminUser: AdminUser,
  now: string,
): MergeResult {
  if (primary.id === secondary.id) {
    throw new Error('mergeSourcedLocationsPure: cannot merge a record into itself');
  }
  if (secondary.mergedInto) {
    throw new Error(
      `mergeSourcedLocationsPure: secondary ${secondary.id} is already merged into ${secondary.mergedInto}`,
    );
  }

  const mergedPrimary = buildUpsertDoc(primary, toMergeInput(secondary), now);
  mergedPrimary.capturedBy = 'admin';

  const mergeNote = `merged:${secondary.id}<-by:${adminUser.email || adminUser.uid}`;
  mergedPrimary.notes = mergedPrimary.notes ? `${mergedPrimary.notes}; ${mergeNote}` : mergeNote;

  // Secondary keeps every field it already had — mergedInto is the only
  // addition. status is deliberately left as-is (not force-set to 'saved').
  const markedSecondary: SourcedParkingLocation = { ...secondary, mergedInto: primary.id };

  return { mergedPrimary, markedSecondary };
}
