import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireFleetKey, FleetAuthError } from '@/lib/fleet/auth';
import { toFleetSiteSummary, filterFleetSites, parseFleetQuery } from '@/lib/fleet/sites';
import { listSourcedLocations } from '@/lib/sourcing/store';

/**
 * GET /api/fleet/sites — the discovery endpoint over the sourced parking
 * master DB. Only ever returns sites inside the live Waymo ODD. Auth:
 * X-API-Key with role 'fleet' (or 'admin').
 *
 * Params (see parseFleetQuery in src/lib/fleet/sites.ts for exact validation):
 *   lat, lng, radiusM   — geo search (radiusM default 5000, max 50000)
 *   minStalls=N         — stall_count >= N
 *   surface_type=surface|structured
 *   gate_type=lpr|manual|automatic|gateless
 *   is_24_7|is_fenced|is_lit=true|false — true requires pass, false requires fail
 *   managed=true|false|any — operator-managed only (DEFAULT true), unmanaged
 *                             only, or everything
 *   status=draft|saved  — default: both (wide net)
 *   maxDistToDemandMi=N — max miles to nearest demand-zone anchor
 *   maxDistToZone=zoneId:maxMi — e.g. mia_airport:3.0
 *   sortBy=nearest|zoneId — sort by demand-zone distance
 *   limit=N             — default 200, max 1000
 *
 * Wide-net rule: unknown is never a fail — filters apply only when asked for.
 */
export async function GET(request: NextRequest) {
  let principal;
  try {
    principal = await requireFleetKey(request);
  } catch (err) {
    if (err instanceof FleetAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const parsed = parseFleetQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { query, status } = parsed.value;

  const locations = await listSourcedLocations({ status, limit: 1000 });
  const results = filterFleetSites(locations, query).map((loc) => toFleetSiteSummary(loc, query.center));
  // filterFleetSites already sorts by demand distance when sortBy is set.
  // Only sort by geo distance when center is given AND no demand sort requested.
  if (query.center && !query.sortBy) results.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));

  return NextResponse.json({ fleet: principal.fleet, count: results.length, results });
}
