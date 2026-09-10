import 'server-only';
import { runFirecrawlExtract } from './firecrawlExtractClient.ts';
import { getSourcedLocation } from './store.ts';
import {
  computeExtensionDedupeKey,
  extractFacilitiesFromText,
  parseFirecrawlExtractResponse,
  stripHtmlToText,
  tagExtractedFacilities,
} from './extensionCapture.ts';
import type { ExtractedFacility, TaggedFacility } from './extensionCapture.ts';

// Thin server-only I/O wrapper around extensionCapture.ts's pure parse/tag
// logic — same split as store.ts vs types.ts. Two capture surfaces share the
// dedupe-tag step below but differ in HOW they get from raw input to
// ExtractedFacility[]: the extension captures arbitrary unknown live pages
// (no per-site adapter to lean on, hence Firecrawl's LLM extraction), while
// the admin portal's "Paste HTML" panel already has the exact HTML in hand
// (no need to pay for/wait on an LLM to parse text we already control), so
// it uses extractFacilitiesFromText's regex-based extraction instead.

async function tagAgainstFirestore(facilities: ExtractedFacility[]): Promise<TaggedFacility[]> {
  const uniqueKeys = [...new Set(facilities.map(computeExtensionDedupeKey))];
  const lookups = await Promise.all(
    uniqueKeys.map(async (key) => [key, await getSourcedLocation(key)] as const),
  );
  const existingIds = new Map<string, string>();
  for (const [key, doc] of lookups) {
    if (doc) existingIds.set(key, doc.id);
  }
  return tagExtractedFacilities(facilities, existingIds);
}

/**
 * Extension capture path: Firecrawl-extract from captured DOM text (any live
 * page the BDR is browsing — see extensionCapture.ts's EXTRACT_SCHEMA
 * docstring for why an LLM step is used here), then dedupe-tag against
 * Firestore. sourceUrl is the page the captured markup came from — required
 * by runFirecrawlExtract's `urls` field and stamped as evidence on import.
 */
export async function parseAndTag(htmlOrText: string, sourceUrl: string): Promise<{ results: TaggedFacility[] }> {
  const strippedText = stripHtmlToText(htmlOrText);
  const raw = await runFirecrawlExtract(sourceUrl, strippedText);
  const facilities = parseFirecrawlExtractResponse(raw);
  return { results: await tagAgainstFirestore(facilities) };
}

/**
 * Admin "Paste HTML" panel path: no LLM, no network call, pure regex
 * extraction — same dedupe-tag step as the extension path, so both surfaces
 * still land on identical NEW/EXISTS/DUPLICATE decisions.
 */
export async function parsePastedFacilities(htmlOrText: string): Promise<{ results: TaggedFacility[] }> {
  const facilities = extractFacilitiesFromText(htmlOrText);
  return { results: await tagAgainstFirestore(facilities) };
}
