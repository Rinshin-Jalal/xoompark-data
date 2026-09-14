// AI enrichment pipeline — multi-stage, pluggable.
//
//   Stage 1: Exa contents (JS rendering → clean text)        [EXA_API_KEY]
//   Stage 2: LLM structured extraction (evidence + confidence) [OPENAI_API_KEY]
//   Stage 3: regex extraction (zero-cost fallback, low confidence)
//
// Each stage activates when its env key exists; otherwise it falls through to
// the next. Regex is the fallback, not the primary extractor.

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

// Regex extractors — signal generator, not the final extractor.
const EXTRACTORS: { field: string; re: RegExp }[] = [
  { field: 'stall_count', re: /(\d{1,4})\s*(?:stalls|spaces|spots|parking spaces)/i },
  { field: 'hours_24_7', re: /(24\s*\/\s*7|open\s+24\s*hours|24\s*hours)/i },
  { field: 'clearance', re: /(\d{1,2}(?:\.\d{1,2})?)\s*(?:ft|feet|')\s*(?:clearance|height)?/i },
  { field: 'phone', re: /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/ },
  { field: 'email', re: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/ },
  { field: 'rates', re: /(\$\d{1,3}(?:\.\d{2})?\s*(?:\/|\sper\s)(?:day|hour|month|hr))/i },
];

/** Extract fields from raw HTML/text with regex. Low confidence — needs human verify. */
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

// ── Stage 1: Exa contents (JS rendering → clean text) ──────────────────────
// Activates when EXA_API_KEY is set. Returns page text, else null.
async function scrapeWithExa(url: string): Promise<string | null> {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ urls: [url], text: true }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

// ── Stage 2: LLM structured extraction (evidence + confidence) ─────────────
// Activates when OPENAI_API_KEY is set. Returns fields with evidence quotes,
// else null. Schema: { field, value, confidence, evidence } per field.
async function extractWithLLM(markdown: string, sourceUrl: string): Promise<EnrichmentField[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract parking-lot fields from the page. Return JSON: {"fields":[{"field":"stall_count|hours|clearance|phone|email|rates","value":"...","confidence":0..1,"evidence":"exact quote from page"}]}. Only include fields actually present. Never guess.',
          },
          { role: 'user', content: markdown.slice(0, 12000) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    const fields = (parsed.fields ?? []) as { field: string; value: string; confidence: number; evidence: string }[];
    return fields.map((f) => ({
      field: f.field,
      value: String(f.value ?? '').trim(),
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
      source: sourceUrl,
      snippet: f.evidence ?? '',
      verified: false,
    }));
  } catch {
    return null;
  }
}

/** Fetch a URL and extract fields. Exa → LLM → regex fallback. */
export async function scrapeAndExtract(sourceUrl: string): Promise<EnrichmentResult> {
  const scrapedAt = new Date().toISOString();

  // Stage 1: Exa contents (JS rendering).
  const text = await scrapeWithExa(sourceUrl);
  if (text) {
    // Stage 2: LLM extraction on clean text.
    const llmFields = await extractWithLLM(text, sourceUrl);
    if (llmFields && llmFields.length > 0) {
      return { fields: llmFields, scrapedAt, sourceUrl, status: 'ok' };
    }
    // Fallback: regex on the text.
    return { fields: extractFields(text, sourceUrl), scrapedAt, sourceUrl, status: 'ok' };
  }

  // Stage 3: static fetch + regex (zero-cost baseline).
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (XoomPark enrichment)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { fields: [], scrapedAt, sourceUrl, status: 'blocked', error: `HTTP ${res.status}` };
    const html = await res.text();
    return { fields: extractFields(html, sourceUrl), scrapedAt, sourceUrl, status: 'ok' };
  } catch (err) {
    return {
      fields: [],
      scrapedAt,
      sourceUrl,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}