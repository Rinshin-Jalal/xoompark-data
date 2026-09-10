// Pure parse/tag logic for the browser-extension capture pipeline
// (POST /api/sourcing/capture, POST /api/sourcing/import). Deliberately
// Firestore- and network-free (same split as lazParse.ts/spotheroParse.ts)
// so it runs under plain `node --experimental-strip-types` — the route
// handlers are thin wrappers that do the actual Firecrawl call and Firestore
// reads/writes around these functions.
import { slugifyCity } from '../citySlug.ts';
import { computeDedupeKey, normalizeAddress } from './types.ts';
import type { CapturedBy, FieldProvenanceValue, SourcedLocationInput } from './types.ts';

// --- HTML -> plain text (paste-HTML capture panel) --------------------------

/**
 * Normalize a pasted "inspect element -> copy HTML" blob (or already-plain
 * text) into the same kind of captured-page text the extension's content
 * script hands to buildExtractPrompt. No-op (just whitespace-collapsed) when
 * the input has no `<` at all — already plain text.
 *
 * ponytail: regex-based tag strip, not a real HTML parser — can mangle
 * heavily-nested or malformed markup (e.g. a stray `<` inside a JS string
 * literal). Upgrade to a real HTML parser (e.g. linkedom) if that turns out
 * to matter in practice.
 */
export function stripHtmlToText(htmlOrText: string): string {
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (!htmlOrText.includes('<')) return collapse(htmlOrText);

  const withoutScriptsAndStyles = htmlOrText
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, ' ');
  return collapse(withoutTags);
}

// --- Regex-based field extraction (paste-HTML capture panel) ----------------
//
// ponytail: heuristic regex extraction, not a real HTML parser or LLM. The
// admin portal's paste box already has the exact HTML in hand, so an LLM
// round-trip to parse text we already control is unnecessary — unlike the
// extension path below, which captures arbitrary unknown pages and has no
// per-site adapter to lean on. Block-splitting only kicks in when the pasted
// markup has an obviously repeated container (same tag+class appearing 2+
// times) — otherwise the whole paste is treated as ONE facility, which is
// also the common case (an admin usually copies one listing's card, not a
// whole page). Field regexes are best-effort and can miss or mis-tag unusual
// formats — the admin reviews/selects rows before import, so a missed field
// just means re-typing it later, not a bad write. Upgrade path: a real HTML
// parser (e.g. node-html-parser) if this proves too lossy in practice.

function splitIntoBlocks(raw: string): string[] {
  if (!raw.includes('<')) return [raw];

  const repeatedTagRe = /<([a-z][a-z0-9]*)\b[^>]*\bclass=["']([^"']+)["'][^>]*>/gi;
  const positionsByKey = new Map<string, number[]>();
  let m: RegExpExecArray | null;
  while ((m = repeatedTagRe.exec(raw))) {
    const key = `${m[1].toLowerCase()}::${m[2].trim()}`;
    const positions = positionsByKey.get(key) ?? [];
    positions.push(m.index);
    positionsByKey.set(key, positions);
  }

  let bestPositions: number[] = [];
  for (const positions of positionsByKey.values()) {
    if (positions.length >= 2 && positions.length > bestPositions.length) bestPositions = positions;
  }
  if (bestPositions.length < 2) return [raw];

  return bestPositions.map((start, i) => raw.slice(start, bestPositions[i + 1] ?? raw.length));
}

const NAME_TAG_RE = /<(h1|h2|h3|h4|h5|a|strong)\b[^>]*>([\s\S]*?)<\/\1>/i;
const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)?\s*(?:hour|hr|day|month|mo|week|wk)\b/i;
const HOURS_RE = /(?:24\s?\/\s?7|24\s*hours?|open\s*24)|(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z,\-\s]{0,20}\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–to]{1,3}\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;
const ADDRESS_RE = /\d{1,6}\s+[A-Za-z0-9.'\s]{2,40}?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)\b\.?,?\s*(?:[A-Za-z\s]{2,30},?\s*)?[A-Z]{2}\s*\d{5}?/;
const CAPACITY_RE = /\d{2,5}\s*(?:spaces|stalls|spots)\b/i;
const CLEARANCE_RE = /\d{1,2}['’]\s?\d{0,2}"?\s*clearance\b|clearance[:\s]{1,4}\d{1,2}['’]\s?\d{0,2}"?/i;

function extractName(rawBlock: string, collapsedText: string): string | undefined {
  const tagMatch = rawBlock.match(NAME_TAG_RE);
  if (tagMatch) {
    const text = stripHtmlToText(tagMatch[2]);
    if (text) return text.slice(0, 120);
  }
  // Line breaks are real signal in plain-text pastes ("name on its own
  // line") but stripHtmlToText already collapsed them by the time
  // collapsedText gets here — so split the RAW block on newlines first.
  const rawFirstLine = rawBlock
    .split('\n')
    .map((s) => stripHtmlToText(s))
    .find((s) => s.length > 2);
  if (rawFirstLine) return rawFirstLine.slice(0, 120);

  const firstSentence = collapsedText
    .split(/[.!?]\s/)
    .map((s) => s.trim())
    .find((s) => s.length > 2);
  return firstSentence ? firstSentence.slice(0, 120) : undefined;
}

function extractFacilityFromBlock(block: string): ExtractedFacility | null {
  const text = stripHtmlToText(block);
  if (!text) return null;

  const name = extractName(block, text);
  if (!name) return null;

  return {
    name,
    address: text.match(ADDRESS_RE)?.[0].trim(),
    priceText: text.match(PRICE_RE)?.[0].trim(),
    hoursText: text.match(HOURS_RE)?.[0].trim(),
    capacityText: text.match(CAPACITY_RE)?.[0].trim(),
    clearanceText: text.match(CLEARANCE_RE)?.[0].trim(),
  };
}

/**
 * Turn a pasted "inspect element -> copy HTML" blob (or plain text) into
 * ExtractedFacility rows, purely via regex — no LLM, no network call.
 */
export function extractFacilitiesFromText(htmlOrText: string): ExtractedFacility[] {
  const blocks = splitIntoBlocks(htmlOrText);
  const out: ExtractedFacility[] = [];
  for (const block of blocks) {
    const facility = extractFacilityFromBlock(block);
    if (facility) out.push(facility);
  }
  return out;
}

// --- Firecrawl /v1/extract request shape ------------------------------------

/**
 * Schema-constrained prompt request. Recon (2026-08-24, real /v1/extract
 * calls against spothero.com/destination/miami/downtown-miami-parking):
 * /v1/extract's `urls` field is REQUIRED and always fetched by Firecrawl
 * itself — there is no "content"/"html"/"markdown" override field (checked
 * against the API reference; a data: URI in `urls` is rejected with
 * "Invalid URL"/"must have a valid top-level domain"). This directly
 * conflicts with the task's "don't have Firecrawl re-fetch the URL" intent,
 * since the whole point is extracting from what the extension's content
 * script already captured (possibly authenticated/rendered state Firecrawl's
 * own fetch can't reach).
 *
 * Resolution, verified empirically: embed the captured domText directly in
 * the `prompt` field with an explicit "use ONLY this text" instruction, and
 * still pass the real page URL in `urls` (required, and Firecrawl does fetch
 * it in the background — unavoidable). A controlled test confirmed the LLM
 * extraction step is grounded in the prompt-embedded text, not Firecrawl's
 * own fetch: passing urls:['https://example.com'] (no parking content at
 * all) with a prompt embedding a fabricated "ZorpGarage, 999 Nonexistent
 * Ave, $42/day, Open 24/7" text block returned exactly that fabricated
 * facility — proof the prompt block dominates over whatever Firecrawl's own
 * fetch of the real URL turned up. So this is the closest achievable
 * approximation of "extract from the captured page, not a re-fetch" that
 * the real /v1/extract API surface allows.
 *
 * Also confirmed: /v1/extract is deprecated in favor of /v2/scrape with a
 * `formats: [{type:'json', ...}]` entry (every response carries a
 * `warnings`/`replacement` field saying so) — kept on /v1/extract per this
 * task's explicit instruction; /v1/extract still works today (2026-08-24).
 */
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    facilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          address: { type: 'string' },
          priceText: { type: 'string' },
          hoursText: { type: 'string' },
          capacityText: { type: 'string' },
          clearanceText: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  required: ['facilities'],
} as const;

export function buildExtractPrompt(domText: string): string {
  return [
    'Extract every distinct parking facility/garage/lot listed in the CAPTURED PAGE TEXT block below.',
    'Use ONLY the text in the CAPTURED PAGE TEXT block as your source of truth — do not use any other',
    'knowledge or any other fetch of this URL. For each facility return: name (required), address,',
    'priceText (rate as shown, verbatim — never compute or estimate one), hoursText (verbatim),',
    'capacityText (verbatim, only if a stall/space count is explicitly stated), clearanceText (verbatim,',
    'only if a height/clearance is explicitly stated). Omit a field entirely if the text does not state it',
    '— never guess or infer a value.',
    '',
    '--- CAPTURED PAGE TEXT ---',
    domText,
    '--- END CAPTURED PAGE TEXT ---',
  ].join('\n');
}

// --- Extracted facility shape -----------------------------------------------

export interface ExtractedFacility {
  name: string;
  address?: string;
  priceText?: string;
  hoursText?: string;
  capacityText?: string;
  clearanceText?: string;
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parse Firecrawl's completed /v1/extract response body into a facility
 * array. Real shape (recon 2026-08-24): {success, data: {facilities: [...]},
 * status: 'completed', ...}. Missing fields come back as "" (empty string),
 * NOT omitted — normalized to undefined here so downstream code can use the
 * same isEmpty checks the rest of sourcing/ relies on (buildUpsertDoc's
 * SOFT_FIELDS fill-empty logic treats '' as empty too, but never trust that
 * silently — normalize at the boundary).
 */
export function parseFirecrawlExtractResponse(raw: unknown): ExtractedFacility[] {
  const body = raw as { success?: boolean; data?: { facilities?: unknown[] }; error?: string } | null;
  if (!body || body.success !== true) {
    throw new Error(`Firecrawl extract did not succeed: ${body?.error ?? 'unknown error'}`);
  }
  const rawFacilities = body.data?.facilities;
  if (!Array.isArray(rawFacilities)) return [];

  const out: ExtractedFacility[] = [];
  for (const item of rawFacilities) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = cleanStr(rec.name);
    if (!name) continue; // name is required — unnamed rows are unusable
    out.push({
      name,
      address: cleanStr(rec.address),
      priceText: cleanStr(rec.priceText),
      hoursText: cleanStr(rec.hoursText),
      capacityText: cleanStr(rec.capacityText),
      clearanceText: cleanStr(rec.clearanceText),
    });
  }
  return out;
}

// --- Dedupe tagging ----------------------------------------------------------

export type CaptureTag = 'NEW' | 'EXISTS' | 'DUPLICATE';

export interface TaggedFacility extends ExtractedFacility {
  dedupeKey: string;
  tag: CaptureTag;
  existingId?: string;
}

/**
 * source:sourceListingId used for every extension capture — mirrors
 * addLocation.ts's own scheme exactly (the task's named closest analog for
 * "human-provided/external listing becoming a SourcedLocationInput"):
 * slugifyCity(`${name}-${address}` or just `name`) capped at 80 chars,
 * under a dedicated 'extension' source namespace.
 *
 * Deliberately NOT the plain computeDedupeKey `addr:<slug>` fallback that
 * fires when no sourceListingId is given: every OTHER adapter in this
 * codebase (SpotHero: spot.spotId, Parkopedia: loc.id, LAZ: derived from its
 * own URL path, manual: this same name+address slug) already sets its own
 * sourceListingId, keeping each source in its own dedupe keyspace rather
 * than auto-colliding across sources — cross-source reconciliation is a
 * deliberate human step via the existing admin merge UI
 * (mergeSourcedLocations), not something dedupe tagging should do silently.
 * Matching addLocation.ts's scheme also means EXISTS never throws on a
 * facility with no address (computeDedupeKey with neither sourceListingId
 * nor address would throw) — same-batch capacity has to hold either way.
 */
export function computeExtensionDedupeKey(facility: ExtractedFacility): string {
  const slugBase = facility.address ? `${facility.name}-${facility.address}` : facility.name;
  const sourceListingId = slugifyCity(slugBase).slice(0, 80);
  const normalizedAddress = facility.address ? normalizeAddress(facility.address) : undefined;
  return computeDedupeKey({ source: 'extension', sourceListingId, normalizedAddress });
}

/**
 * Pure dedupe-tag decision — no Firestore involved. Callers (the /capture
 * route handler) compute each facility's dedupeKey via
 * computeExtensionDedupeKey, batch-check Firestore for which of those keys
 * already have a doc, and pass the resulting set in as `existingIds`
 * (dedupeKey -> existing doc id, usually the same string but kept distinct
 * in case that ever changes).
 *
 * Tag rules (see route handler docstring for the full rationale):
 *  - EXISTS: this key already has a Firestore doc (existingIds has it) —
 *    checked BEFORE the in-batch duplicate check, so an EXISTS beats a
 *    same-batch DUPLICATE (a firm Firestore match is the stronger signal).
 *  - DUPLICATE: not in Firestore, but a facility earlier in THIS SAME batch
 *    already produced the same key (first occurrence keeps its own tag —
 *    NEW or EXISTS — only later same-key occurrences are marked DUPLICATE).
 *  - NEW: neither of the above.
 */
export function tagExtractedFacilities(
  facilities: ExtractedFacility[],
  existingIds: ReadonlyMap<string, string>,
): TaggedFacility[] {
  const seenInBatch = new Set<string>();
  return facilities.map((facility) => {
    const dedupeKey = computeExtensionDedupeKey(facility);
    const existingId = existingIds.get(dedupeKey);

    let tag: CaptureTag;
    if (existingId) {
      tag = 'EXISTS';
    } else if (seenInBatch.has(dedupeKey)) {
      tag = 'DUPLICATE';
    } else {
      tag = 'NEW';
    }
    seenInBatch.add(dedupeKey);

    return { ...facility, dedupeKey, tag, existingId };
  });
}

// --- Import (capture -> SourcedLocationInput) --------------------------------

/**
 * Build the SourcedLocationInput for one imported extension-captured row.
 * sourceUrl is the captured TAB's URL (the live page the BDR was looking
 * at), not a per-facility URL — REQUIRED, same hard rule every other
 * adapter enforces (SpotHero/Parkopedia/LAZ never upsert without one).
 * Returns null when sourceUrl is missing/blank, so the caller can skip and
 * count it rather than upsert with an invalid record.
 */
function buildImportInput(
  facility: ExtractedFacility,
  rawSourceUrl: string,
  source: string,
  capturedBy: CapturedBy,
): SourcedLocationInput | null {
  const sourceUrl = rawSourceUrl?.trim();
  if (!sourceUrl) return null;

  const slugBase = facility.address ? `${facility.name}-${facility.address}` : facility.name;
  const sourceListingId = slugifyCity(slugBase).slice(0, 80);

  const fieldProvenance: Record<string, FieldProvenanceValue> = {};
  for (const [field, present] of [
    ['name', true],
    ['address', !!facility.address],
    ['priceText', !!facility.priceText],
    ['hoursText', !!facility.hoursText],
    ['capacityText', !!facility.capacityText],
    ['clearanceText', !!facility.clearanceText],
  ] as const) {
    if (present) fieldProvenance[field] = 'self-reported';
  }

  return {
    name: facility.name,
    address: facility.address,
    source,
    sourceUrl,
    sourceListingId,
    priceText: facility.priceText,
    hoursText: facility.hoursText,
    capacityText: facility.capacityText,
    clearanceText: facility.clearanceText,
    fieldProvenance,
    capturedBy,
    rawInput: facility,
  };
}

export function buildExtensionImportInput(
  facility: ExtractedFacility,
  capturedTabUrl: string,
): SourcedLocationInput | null {
  return buildImportInput(facility, capturedTabUrl, 'extension', 'bdr-captured');
}

/**
 * Same shape as buildExtensionImportInput above (same extraction, same
 * dedupe/tagging pipeline via parseAndTag in capture.ts) but for the admin
 * portal's in-page "Paste HTML" panel: source:'manual' with addLocation.ts's
 * EXACT sourceListingId slug scheme (slugifyCity(`${name}-${address}` or
 * `name`).slice(0, 80) — same formula buildImportInput already uses above).
 * Deliberate: a paste-HTML capture of a lot that was also manually
 * Add-Location'd collides onto the same dedupe id and goes through the
 * normal upsert merge path, not a separate keyspace. capturedBy is 'admin',
 * not 'bdr-captured' — this is a raw scrape a human parsed-and-reviewed
 * inside the portal, not hand-typed.
 */
export function buildManualPasteImportInput(
  facility: ExtractedFacility,
  sourceUrl: string,
): SourcedLocationInput | null {
  return buildImportInput(facility, sourceUrl, 'manual', 'admin');
}
