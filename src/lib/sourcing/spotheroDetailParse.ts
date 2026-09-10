// Pure parse/map logic for the SpotHero facility-detail enrichment tier —
// deliberately network- and Firestore-free (same split as spotheroParse.ts)
// so it runs under plain `node --experimental-strip-types`.
//
// Recon (2026-08-23): fetched 3 real facility pages (100130 - a valet
// stand, 92951 and 8436 - self-park garages/lots, all Miami). Facility data
// lives in __NEXT_DATA__ at
//   props.pageProps.dehydratedState.queries[<queryKey[0] === 'facility'>].state.data
// (a react-query cache dehydration, same script tag spotheroParse.ts's
// extractNextData already pulls out — reused here, not reimplemented).
// Confirmed present on that data object: title, latitude/longitude,
// address, city, images[], amenities[] ({type, display_name, description}
// — e.g. valet/self-park/covered-parking/touchless/attendant/in-out/
// wheelchair), hoursOfOperation ({periods[], text[], always_open}),
// firstRateInfo (a single live rate quote: cost.value in cents + duration
// string, same shape the city-page tier already captures — NOT a full
// hourly/daily/monthly rate table; no such table was found anywhere in the
// payload), restrictions[] (free-text, e.g. "Height Restriction: 6' 2\"" or
// size-constraint notes), and fullFacilityData.common.clearance_inches (a
// number, e.g. 74) + .facility_type ('garage' | 'lot' | 'valet_stand' —
// confirms self-park vs valet, mirrored in amenities' 'valet'/'self-park'
// entries too). clearance_inches was null on the valet stand and populated
// on both garages/lots.
import type { SourcedLocationInput } from './types.ts';

export interface SpotHeroFacilityDetail {
  title?: string;
  restrictions?: string[];
  amenities?: Array<{ type?: string; display_name?: string }>;
  hoursOfOperation?: {
    periods?: Array<{ first_day?: string; last_day?: string; start_time?: string; end_time?: string }>;
    text?: string[];
    always_open?: boolean;
  };
  firstRateInfo?: {
    cost?: { value?: number; currencyCode?: string };
    duration?: string;
  };
  /** How you get in/out — "Our cameras will recognize your license plate",
   * "Just drive in". Gate-behaviour evidence (see gateEvidence.ts). */
  redemptionInstructions?: Array<{ text?: string }> | null;
  /** Entrance narrative — "Enter at 244 NE 3rd St... one-way street".
   * Ingress/egress evidence. */
  gettingHere?: string | null;
  fullFacilityData?: {
    common?: {
      clearance_inches?: number | null;
      facility_type?: string;
    };
  };
}

/** Pull the 'facility' react-query cache entry out of a parsed __NEXT_DATA__ object, or null. */
export function extractFacilityQueryData(nextData: unknown): SpotHeroFacilityDetail | null {
  const data = nextData as {
    props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: unknown } }> } } };
  } | null;
  const queries = data?.props?.pageProps?.dehydratedState?.queries ?? [];
  const facilityQuery = queries.find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'facility');
  return (facilityQuery?.state?.data as SpotHeroFacilityDetail | undefined) ?? null;
}

/** Verbatim height-restriction text if present, else a formatted clearance_inches fallback. */
function extractClearanceText(detail: SpotHeroFacilityDetail): string | undefined {
  const heightLine = (detail.restrictions ?? []).find((r) => /height restriction/i.test(r));
  if (heightLine) return heightLine;
  const inches = detail.fullFacilityData?.common?.clearance_inches;
  if (typeof inches === 'number' && inches > 0) {
    return `${Math.floor(inches / 12)}'${inches % 12}" clearance`;
  }
  return undefined;
}

function formatHoursText(hours?: SpotHeroFacilityDetail['hoursOfOperation']): string | undefined {
  if (!hours) return undefined;
  if (hours.always_open) return 'Open 24/7';
  if (hours.text?.length) return hours.text.join('; ');
  const p = hours.periods?.[0];
  if (p?.start_time && p?.end_time) {
    return `${p.first_day ?? 'Mon'}-${p.last_day ?? 'Sun'} ${p.start_time.slice(0, 5)}-${p.end_time.slice(0, 5)}`;
  }
  return undefined;
}

/** Same "$X.XX (Nhr)" style as spotheroParse's city-tier formatPriceText — raw quote, never a fabricated rate. */
function formatPriceText(rate?: SpotHeroFacilityDetail['firstRateInfo']): string | undefined {
  const value = rate?.cost?.value;
  if (value === undefined) return undefined;
  const amount = (value / 100).toFixed(2);
  const hoursMatch = rate?.duration?.match(/(\d+(?:\.\d+)?)/);
  return hoursMatch ? `$${amount} (${hoursMatch[1]}hr)` : `$${amount}`;
}

/** Trimmed snapshot for the evidence trail — skips images/schema.org dup,
 * keeps what's actually new here. redemptionInstructions/gettingHere are
 * kept (text only) since 2026-09-04: gate/ingress evidence the fleet side
 * needs (see gateEvidence.ts) — previously discarded. */
function buildEvidenceDetail(detail: SpotHeroFacilityDetail) {
  return {
    clearanceInches: detail.fullFacilityData?.common?.clearance_inches ?? null,
    facilityType: detail.fullFacilityData?.common?.facility_type,
    amenities: (detail.amenities ?? []).map((a) => a.type).filter((t): t is string => !!t),
    restrictions: detail.restrictions ?? [],
    hoursOfOperation: detail.hoursOfOperation,
    firstRateInfo: detail.firstRateInfo,
    redemptionInstructions: (detail.redemptionInstructions ?? [])
      .map((r) => r?.text?.trim()).filter((t): t is string => !!t),
    gettingHere: detail.gettingHere ?? null,
  };
}

/**
 * Map a parsed facility-detail payload to the store's input shape. Always
 * targets an existing record (source/sourceListingId unchanged, same
 * dedupe key as the city-page tier), so buildUpsertDoc always takes the
 * merge branch here and rawInput is discarded — passing null is safe and
 * deliberate (see buildUpsertDoc in types.ts: rawInput is only read on
 * first-create).
 */
export function mapFacilityDetailToInput(
  detail: SpotHeroFacilityDetail,
  sourceUrl: string,
  sourceListingId: string,
): SourcedLocationInput {
  const clearanceText = extractClearanceText(detail);
  const hoursText = formatHoursText(detail.hoursOfOperation);
  const priceText = formatPriceText(detail.firstRateInfo);

  const fieldProvenance: SourcedLocationInput['fieldProvenance'] = {};
  for (const [field, present] of [
    ['clearance_text', !!clearanceText],
    ['hours_text', !!hoursText],
    ['price_text', !!priceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    // The city tier always sets name first, so this only ever hits the
    // conflict-log path (or is a no-op match) — never a blind overwrite.
    name: detail.title ?? `spothero facility ${sourceListingId}`,
    source: 'spothero',
    sourceUrl,
    sourceListingId,
    clearanceText,
    hoursText,
    priceText,
    capturedBy: 'scraped',
    fieldProvenance,
    rawInput: null,
    evidenceDetail: buildEvidenceDetail(detail),
  };
}

/** Up to `limit` spothero records that haven't been through this enrichment tier yet (truthy enrichedAt -> already done, skip). */
export function selectUnenrichedSpotHero<T extends { source_name: string; enriched_at?: string }>(
  records: T[],
  limit: number,
): T[] {
  return records.filter((r) => r.source_name === 'spothero' && !r.enriched_at).slice(0, limit);
}
