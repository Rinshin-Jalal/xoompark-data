import 'server-only';
import type { ChargingSite, ChargingAccessCode, ChargingStationStatus } from '@/lib/types';

// developer.nrel.gov was retired 2026-05-29; NREL (now "National Laboratory
// of the Rockies") moved its developer portal to developer.nlr.gov. Same API,
// same endpoints and params — confirmed against the live docs.
export const BASE_URL = 'https://developer.nlr.gov/api/alt-fuel-stations/v1';

/**
 * Defects in the AFDC query params — all fail quietly with a 200 and plausible
 * data, which is what makes them dangerous:
 *   - limit defaults to 200 and silently truncates; must pass limit=all.
 *   - city= is an exact string match, not a metro (misses Miami Beach, Doral,
 *     etc. for city=Miami) — use a radius search for metro coverage.
 *   - ev_charger_type does nothing at all on nearest.json. Greg's note has this
 *     as "dc_fast is invalid, use DC"; both are wrong, because neither value
 *     filters. Verified live (Austin, 5mi): DC / dc_fast / omitted all return
 *     the same 400 stations, only 34 of which have DC fast ports. We filter
 *     client-side instead — see isDcFastSite below.
 * Context: Greg's AFDC note, Slack, 15 Aug 2026.
 */
export interface AfdcSearchParams {
  lat: number;
  lng: number;
  radiusMiles?: number;
  state?: string;
  /** Include Level 2-only stations (default false = DC-fast only). Used by
   * the sourcing EV enrichment, which counts on-site L2 for overnight
   * fleet charging. */
  includeLevel2?: boolean;
}

interface AfdcConnectorDetail {
  power_kw?: number | null;
  port_count?: number;
}

interface AfdcChargingUnit {
  charging_level?: string; // "1" | "2" | "dc_fast"
  connectors?: Record<string, AfdcConnectorDetail>;
}

interface AfdcRawStation {
  id: number;
  station_name?: string;
  ev_network?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude: number;
  longitude: number;
  ev_dc_fast_num?: number;
  ev_level2_evse_num?: number;
  ev_connector_types?: string[] | string;
  ev_charging_units?: AfdcChargingUnit[];
  access_code?: string;
  access_days_time?: string;
  status_code?: string;
  ev_pricing?: string;
  facility_type?: string;
  owner_type_code?: string;
  updated_at?: string;
  distance?: number;
}

// TESLA is the legacy value for what NREL now also reports as NACS — both appear in the dataset.
const CONNECTOR_MAP: Record<string, string> = {
  J1772COMBO: 'CCS1',
  CCS: 'CCS1',
  CHADEMO: 'CHAdeMO',
  TESLA: 'NACS',
  NACS: 'NACS',
  J1772: 'J1772',
  NEMA1450: 'NEMA 14-50',
  NEMA515: 'NEMA 5-15',
  NEMA520: 'NEMA 5-20',
};

const STATUS_MAP: Record<string, ChargingStationStatus> = {
  E: 'available',
  P: 'planned',
  T: 'temporarily_unavailable',
};

const ACCESS_MAP: Record<string, ChargingAccessCode> = {
  public: 'public',
  private: 'private',
};

const ALWAYS_OPEN_MARKERS = ['24 hours daily', '24/7', '24 hours', 'daily 24'];

function is247(accessDaysTime: string | undefined): boolean {
  if (!accessDaysTime) return false;
  const text = accessDaysTime.toLowerCase();
  return ALWAYS_OPEN_MARKERS.some((m) => text.includes(m));
}

/**
 * ev_dc_power_kw (a flat array on the station) was removed from the schema in
 * the 2026-05-29 developer.nlr.gov migration. Power now lives per-connector,
 * nested inside ev_charging_units, keyed by charging_level ("1"/"2"/"dc_fast").
 * Confirmed live against the migrated API — see afdc.ts module comment.
 *
 * Only dc_fast units count: Level 2's ~6-19kW would otherwise pollute "max
 * power" and misrepresent the DC fast charging speed this field means to show.
 */
function dcFastPowerList(units: AfdcChargingUnit[] | undefined): number[] {
  if (!Array.isArray(units)) return [];
  const out: number[] = [];
  for (const unit of units) {
    if (unit.charging_level !== 'dc_fast') continue;
    for (const detail of Object.values(unit.connectors ?? {})) {
      if (typeof detail?.power_kw === 'number' && Number.isFinite(detail.power_kw) && detail.power_kw > 0) {
        out.push(detail.power_kw);
      }
    }
  }
  return Array.from(new Set(out)).sort((a, b) => b - a);
}

function normalizeStation(raw: AfdcRawStation): ChargingSite | null {
  if (typeof raw.latitude !== 'number' || typeof raw.longitude !== 'number') return null;

  const connectorsRaw = Array.isArray(raw.ev_connector_types)
    ? raw.ev_connector_types
    : raw.ev_connector_types
      ? [raw.ev_connector_types]
      : [];
  const connectors = Array.from(new Set(connectorsRaw.map((c) => CONNECTOR_MAP[c] ?? c))).sort();

  const power = dcFastPowerList(raw.ev_charging_units);
  const accessRaw = (raw.access_code ?? '').toLowerCase();
  const statusRaw = (raw.status_code ?? '').toUpperCase();

  return {
    afdcId: raw.id,
    name: raw.station_name || 'Unnamed station',
    network: raw.ev_network || null,
    streetAddress: raw.street_address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.zip || null,
    lat: raw.latitude,
    lng: raw.longitude,
    dcFastPorts: raw.ev_dc_fast_num ?? 0,
    level2Ports: raw.ev_level2_evse_num ?? 0,
    connectors,
    // Absent is null, never 0 — 0 would read as a dead station.
    powerKw: power,
    maxPowerKw: power.length ? power[0] : null,
    access: ACCESS_MAP[accessRaw] ?? 'unknown',
    accessHours: raw.access_days_time ?? null,
    is247: is247(raw.access_days_time),
    status: STATUS_MAP[statusRaw] ?? 'unknown',
    pricing: raw.ev_pricing || null,
    facilityType: raw.facility_type || null,
    ownerType: raw.owner_type_code || null,
    updatedAt: raw.updated_at || null,
    distanceMiles: typeof raw.distance === 'number' ? raw.distance : null,
  };
}

/**
 * Radius search around a point — always used over a city/state filter, which
 * is an exact string match and misses the surrounding metro (see module docs).
 */
/**
 * AFDC's `ev_charger_type` parameter is inert on `nearest.json`. Verified live
 * (Austin, 5mi): `DC`, `dc_fast` and omitting it entirely return byte-identical
 * sets — 400 stations, of which 34 actually have DC fast ports. The endpoint
 * returns every public EV station regardless, overwhelmingly Level 2.
 *
 * So the filter has to live here. Without it a metro search hands BD roughly
 * 12x too many rows, mostly apartment-block Level 2 chargers, and every one of
 * them looks like a fast-charging site worth calling.
 */
export function isDcFastSite(site: ChargingSite): boolean {
  return site.dcFastPorts > 0;
}

export async function searchChargingSites({
  lat,
  lng,
  radiusMiles = 25,
  includeLevel2 = false,
}: AfdcSearchParams): Promise<ChargingSite[]> {
  const apiKey = process.env.NREL_API_KEY;
  if (!apiKey) {
    // A missing key silently falls back to NREL's shared DEMO_KEY (~30 req/hour
    // per IP) and looks like a working integration until it starts 429ing in
    // production. Fail loudly instead.
    throw new Error('NREL_API_KEY is not set. Register free at https://developer.nlr.gov/signup/');
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    fuel_type: 'ELEC',
    status: 'E',
    access: 'public',
    country: 'US',
    latitude: String(lat),
    longitude: String(lng),
    radius: String(radiusMiles),
    limit: 'all',
  });

  // No Next fetch cache: a populated metro (e.g. Miami 25mi ≈ 1000+ stations)
  // returns a multi-MB body, well past Next's 2MB data-cache entry limit —
  // confirmed live, it fails silently and just never caches. Every search is
  // a live call; that's the correct behavior anyway, just without the
  // (already-nonfunctional) caching layer.
  const res = await fetch(`${BASE_URL}/nearest.json?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AFDC request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const body = (await res.json()) as { fuel_stations?: AfdcRawStation[]; error?: unknown };
  if (body.error) {
    throw new Error(`AFDC error: ${JSON.stringify(body.error)}`);
  }

  const stations = body.fuel_stations ?? [];
  return stations
    .map(normalizeStation)
    .filter((s): s is ChargingSite => s !== null)
    .filter((s) => (includeLevel2 ? s.dcFastPorts > 0 || s.level2Ports > 0 : isDcFastSite(s)));
}
