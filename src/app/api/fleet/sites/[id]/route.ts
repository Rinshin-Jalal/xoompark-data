import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireFleetKey, FleetAuthError } from '@/lib/fleet/auth';
import { toFleetSiteDetail } from '@/lib/fleet/sites';
import { getSourcedLocation } from '@/lib/sourcing/store';

/**
 * GET /api/fleet/sites/:id — the bring-up package for one site. Everything
 * we hold except internal workflow fields (rawInput, claimedBy, addedBy,
 * fieldProvenance, evidence) — see toFleetSiteDetail for the allowlist
 * discipline.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFleetKey(request);
  } catch (err) {
    if (err instanceof FleetAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const { id } = await params;
  const location = await getSourcedLocation(id);
  if (!location || location.mergedInto) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  return NextResponse.json({ site: toFleetSiteDetail(location) });
}
