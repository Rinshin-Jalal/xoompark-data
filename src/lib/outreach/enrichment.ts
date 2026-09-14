// AI enrichment pipeline — Level 1 (regex extraction, no LLM). The layered
// architecture from the expert review: Firecrawl scrape → LLM extract → Exa
// research → human verify. Level 1 runs cheap regex extraction on a fetched
// page; Firecrawl/Exa/LLM plug in later when API keys exist.

export type EnrichmentField = {
  field: string;
  value: string;
  confidence: number; // 0..1
  source: string; // URL
  snippet: string; // raw text the value came from
  verified: boolean; // human-verified flag
};

export type EnrichmentResult = {
  fields: EnrichmentField[];
  scrapedAt: string;
  sourceUrl: string;
  status: 'ok' | 'failed' | 'blocked';
  error?: string;
};

// Regex extractors — each returns { value, snippet } or null.
const EXTRACTORS: { field: string; re: RegExp }[] = [
  { field: 'stall_count', re: /(\d{1,4})\s*(?:stalls|spaces|spots|parking spaces)/i },
  { field: 'hours_24_7', re: /(24\s*\/\s*7|open\s+24\s*hours|24\s*hours)/i },
  { field: 'clearance', re: /(\d{1,2}(?:\.\d{1,2})?)\s*(?:ft|feet|')\s*(?:clearance|height)?/i },
  { field: 'phone', re: /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/ },
  { field: 'email', re: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/ },
  { field: 'rates', re: /(\$\d{1,3}(?:\.\d{2})?\s*(?:\/|\sper\s)(?:day|hour|month|hr))/i },
];

/** Extract fields from raw HTML/text with regex. Confidence is a rough
 * heuristic — regex matches are low-confidence until a human verifies. */
export function extractFields(html: string, sourceUrl: string): EnrichmentField[] {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const fields: EnrichmentField[] = [];

  for (const { field, re } of EXTRACTORS) {
    const m = text.match(re);
    if (m) {
      fields.push({
        field,
        value: m[1].trim(),
        confidence: 0.6, // regex match — needs human verification
        source: sourceUrl,
        snippet: text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 80),
        verified: false,
      });
    }
  }
  return fields;
}

/** Fetch a URL and extract fields. Falls back to a failed status on error. */
export async function scrapeAndExtract(sourceUrl: string): Promise<EnrichmentResult> {
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (XoomPark enrichment)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { fields: [], scrapedAt: new Date().toISOString(), sourceUrl, status: 'blocked', error: `HTTP ${res.status}` };
    const html = await res.text();
    const fields = extractFields(html, sourceUrl);
    return { fields, scrapedAt: new Date().toISOString(), sourceUrl, status: 'ok' };
  } catch (err) {
    return {
      fields: [],
      scrapedAt: new Date().toISOString(),
      sourceUrl,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}