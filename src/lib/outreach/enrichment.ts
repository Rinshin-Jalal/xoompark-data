// AI enrichment pipeline — multi-stage, pluggable.
//
//   Stage 1: Exa contents (JS rendering → clean text)        [EXA_API_KEY]
//   Stage 2: Cloudflare Workers AI extraction (evidence + confidence)
//                                                            [CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN]
//   Stage 3: Google Places (hours/phone/website validation)  [NEXT_PUBLIC_GOOGLE_MAPS_API_KEY]
//   Stage 4: regex extraction (zero-cost fallback, low confidence)
//
// Each stage activates when its env key exists; otherwise it falls through to
// the next. Regex is the fallback, not the primary extractor.

export type EnrichmentField = {
  field: string;
  value: string;
  confidence: number; // 0..1
  source: string; // URL or 'google_places'
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

// ── Stage 2: Cloudflare Workers AI extraction (evidence + confidence) ──────
// Activates when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN are set. Returns
// fields with evidence quotes, else null. Schema: {field, value, confidence,
// evidence} per field.
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Whitelist — drop any field the model invents outside the schema.
const KNOWN_FIELDS = new Set(['stall_count', 'hours', 'clearance', 'phone', 'email', 'rates', 'operator', 'address']);

const EXTRACT_PROMPT =
  'Extract parking-lot fields from the page. Return ONLY a JSON object with a "fields" array. Each element is a SEPARATE object with keys "field", "value", "confidence", "evidence".\n' +
  'Example output:\n' +
  '{"fields":[{"field":"stall_count","value":"420","confidence":0.9,"evidence":"420 parking spaces"},{"field":"hours","value":"24/7","confidence":0.9,"evidence":"Open 24 hours"},{"field":"clearance","value":"7\'0\\"","confidence":0.9,"evidence":"Height restriction 7\'0\\""}]}\n' +
  'Rules:\n' +
  '- field must be one of: stall_count, hours, clearance, phone, email, rates, operator, address.\n' +
  '- clearance: ONLY a height clearance/restriction (e.g. "7\'0\\" height restriction"). NOT length, width, or vehicle dimensions. Omit if not a height restriction.\n' +
  '- operator: the parking operator/management company (e.g. "LAZ Parking", "SP+"), from branding/footer. NOT the property owner.\n' +
  '- address: the full street address of the facility.\n' +
  '- Only include fields actually present. Never guess. Never combine multiple fields into one.';

export async function extractWithLLM(text: string, sourceUrl: string): Promise<EnrichmentField[] | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return null;
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: text.slice(0, 12000) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data?.result?.choices?.[0]?.message?.content ?? data?.result?.response ?? '') as string;
    const json = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(json);
    const fields = (parsed.fields ?? []) as { field: string; value: string; confidence: number; evidence: string }[];
    return fields
      .filter((f) => KNOWN_FIELDS.has(f.field))
      .map((f) => ({
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

// ── Stage 3: Google Places (hours/phone/website validation) ────────────────
// Activates when GOOGLE_MAPS_SERVER_KEY is set (a server-side key with IP
// restrictions — the NEXT_PUBLIC browser key is referer-restricted and can't
// call Places server-side). Two-step: find place_id, then fetch details.
export async function enrichWithGooglePlaces(name: string, address: string): Promise<EnrichmentField[]> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key || !name) return [];
  try {
    const query = encodeURIComponent(`${name} ${address ?? ''}`.trim());
    const findRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id&key=${key}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!findRes.ok) return [];
    const findData = await findRes.json();
    const placeId = findData?.candidates?.[0]?.place_id;
    if (!placeId) return [];

    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,opening_hours,website&key=${key}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!detailRes.ok) return [];
    const detailData = await detailRes.json();
    const place = detailData?.result;
    if (!place) return [];

    const fields: EnrichmentField[] = [];
    if (place.formatted_phone_number) {
      fields.push({ field: 'phone', value: place.formatted_phone_number, confidence: 0.9, source: 'google_places', snippet: 'Google Places', verified: false });
    }
    if (place.website) {
      fields.push({ field: 'website', value: place.website, confidence: 0.9, source: 'google_places', snippet: 'Google Places', verified: false });
    }
    if (place.opening_hours?.weekday_text?.length) {
      fields.push({ field: 'hours', value: place.opening_hours.weekday_text.join('; '), confidence: 0.9, source: 'google_places', snippet: 'Google Places', verified: false });
    }
    return fields;
  } catch {
    return [];
  }
}

// ── Stage 4: OpenStreetMap (stall capacity + EV chargers) ──────────────────
// Free. Queries Overpass for parking capacity and nearby charging stations.
export async function enrichWithOSM(lat: number | undefined, lng: number | undefined): Promise<EnrichmentField[]> {
  if (lat == null || lng == null) return [];
  try {
    const query = `[out:json];(way(around:100,${lat},${lng})[amenity=parking][capacity];node(around:100,${lat},${lng})[amenity=charging_station];);out tags;`;
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const fields: EnrichmentField[] = [];
    for (const el of data.elements ?? []) {
      if (el.tags?.capacity) {
        fields.push({ field: 'stall_count', value: String(el.tags.capacity), confidence: 0.7, source: 'openstreetmap', snippet: `OSM capacity=${el.tags.capacity}`, verified: false });
      }
      if (el.tags?.amenity === 'charging_station') {
        fields.push({ field: 'ev', value: 'yes', confidence: 0.7, source: 'openstreetmap', snippet: 'OSM charging_station nearby', verified: false });
      }
    }
    return fields;
  } catch {
    return [];
  }
}

// ── Stage 5: Exa search (operator discovery) ───────────────────────────────
// When the page doesn't name the operator, semantic-search for it and extract
// the operator from the top results via the LLM.
export async function enrichWithExaSearch(name: string, address: string): Promise<EnrichmentField[]> {
  const key = process.env.EXA_API_KEY;
  if (!key || !name) return [];
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        query: `${name} ${address ?? ''} parking operator managed by`,
        numResults: 3,
        contents: { text: true },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.results ?? [];
    if (results.length === 0) return [];
    const combined = results.map((r: { title?: string; text?: string }) => `${r.title ?? ''}\n${r.text ?? ''}`).join('\n\n');
    const llmFields = await extractWithLLM(combined, 'exa_search');
    return (llmFields ?? []).filter((f) => f.field === 'operator');
  } catch {
    return [];
  }
}
export async function scrapeAndExtract(sourceUrl: string, surfaceType?: string | null): Promise<EnrichmentResult> {
  const scrapedAt = new Date().toISOString();

  let fields: EnrichmentField[] = [];

  // Stage 1: Exa contents (JS rendering).
  const text = await scrapeWithExa(sourceUrl);
  if (text) {
    // Stage 2: LLM extraction on clean text.
    const llmFields = await extractWithLLM(text, sourceUrl);
    if (llmFields && llmFields.length > 0) {
      fields = llmFields;
    } else {
      // Fallback: regex on the text.
      fields = extractFields(text, sourceUrl);
    }
  } else {
    // Stage 4: static fetch + regex (zero-cost baseline).
    try {
      const res = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (XoomPark enrichment)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { fields: [], scrapedAt, sourceUrl, status: 'blocked', error: `HTTP ${res.status}` };
      const html = await res.text();
      fields = extractFields(html, sourceUrl);
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

  // Surface lots have no height clearance — drop any false-positive match.
  if (surfaceType === 'surface') {
    fields = fields.filter((f) => f.field !== 'clearance');
  }

  return { fields, scrapedAt, sourceUrl, status: 'ok' };
}

// ── Full pipeline: scrape → Google Places → OSM → Exa operator search ──────
// Shared by the enrichLot action and the batch script. Merge order: Google
// Places wins for phone/hours/website; OSM fills stall_count/ev gaps; Exa
// search fills operator only when the page didn't name one.
export async function runEnrichment(
  lot: {
    name: string;
    address?: string;
    source_url: string;
    surface_type?: string | null;
    lat?: number;
    lng?: number;
  },
  skipPlaces = false,
): Promise<EnrichmentResult> {
  const result = await scrapeAndExtract(lot.source_url, lot.surface_type);

  if (!skipPlaces) {
    const gpFields = await enrichWithGooglePlaces(lot.name, lot.address ?? '');
    if (gpFields.length > 0) {
      const gpKeys = new Set(gpFields.map((f) => f.field));
      result.fields = [...result.fields.filter((f) => !gpKeys.has(f.field)), ...gpFields];
    }
  }

  const osmFields = await enrichWithOSM(lot.lat, lot.lng);
  if (osmFields.length > 0) {
    const have = new Set(result.fields.map((f) => f.field));
    result.fields = [...result.fields, ...osmFields.filter((f) => !have.has(f.field))];
  }

  if (!result.fields.some((f) => f.field === 'operator')) {
    const exaFields = await enrichWithExaSearch(lot.name, lot.address ?? '');
    if (exaFields.length > 0) result.fields = [...result.fields, ...exaFields];
  }

  return result;
}