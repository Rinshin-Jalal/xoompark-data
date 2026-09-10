import 'server-only';
import { EXTRACT_SCHEMA, buildExtractPrompt } from './extensionCapture.ts';

// Server-only network wrapper around Firecrawl's /v1/extract. See
// extensionCapture.ts's EXTRACT_SCHEMA docstring for the full recon writeup
// (why urls is still required, why the prompt embeds the captured domText,
// the deprecation warning). Unlike laz.ts's /v1/scrape (synchronous,
// one request), /v1/extract is a two-phase async job: POST kicks it off and
// returns a job id, then GET /v1/extract/:id is polled until status is no
// longer 'processing'. Never logs the API key, only whether it's present —
// same discipline as fetchFirecrawlMarkdown in laz.ts.
const FIRECRAWL_EXTRACT_URL = 'https://api.firecrawl.dev/v1/extract';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20; // ~60s ceiling — real jobs above completed in a few s

function getApiKey(): string {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
  return apiKey;
}

/** 3-retry backoff on 429/5xx, mirrors fetchFirecrawlMarkdown in laz.ts. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const apiKey = getApiKey();
  let res: Response | undefined;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.ok) break;
    lastStatus = res.status;
    if (![429, 502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`Firecrawl extract request failed: HTTP ${lastStatus || res?.status}`);
  return res;
}

interface ExtractKickoffResponse {
  success?: boolean;
  id?: string;
  error?: string;
}

interface ExtractPollResponse {
  success?: boolean;
  status?: 'processing' | 'completed' | 'failed' | 'cancelled';
  data?: unknown;
  error?: string;
}

/**
 * Run one Firecrawl /v1/extract job against `pageUrl` with `domText`
 * embedded in the prompt, poll to completion, and return the raw response
 * body for parseFirecrawlExtractResponse (extensionCapture.ts) to parse —
 * kept as a separate step so the parse logic stays Firestore/network-free
 * and testable, same split as every other adapter in sourcing/.
 */
export async function runFirecrawlExtract(pageUrl: string, domText: string): Promise<unknown> {
  const kickoff = await fetchWithRetry(FIRECRAWL_EXTRACT_URL, {
    method: 'POST',
    body: JSON.stringify({
      urls: [pageUrl],
      prompt: buildExtractPrompt(domText),
      schema: EXTRACT_SCHEMA,
    }),
  });
  const kickoffBody = (await kickoff.json()) as ExtractKickoffResponse;
  if (!kickoffBody.success || !kickoffBody.id) {
    throw new Error(`Firecrawl extract kickoff failed: ${kickoffBody.error ?? 'no job id returned'}`);
  }

  const pollUrl = `${FIRECRAWL_EXTRACT_URL}/${kickoffBody.id}`;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetchWithRetry(pollUrl, { method: 'GET' });
    const pollBody = (await poll.json()) as ExtractPollResponse;
    if (pollBody.status === 'completed') return pollBody;
    if (pollBody.status === 'failed' || pollBody.status === 'cancelled') {
      throw new Error(`Firecrawl extract job ${pollBody.status}: ${pollBody.error ?? 'no error detail'}`);
    }
    // status === 'processing' (or missing) — keep polling
  }
  throw new Error(`Firecrawl extract job ${kickoffBody.id} did not complete within ${MAX_POLLS * POLL_INTERVAL_MS}ms`);
}
