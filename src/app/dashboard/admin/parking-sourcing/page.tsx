import 'server-only';
import { requireAdmin } from '@/lib/requireAdmin';
import { sortForReview } from '@/lib/sourcing/hardFilters';
import { listSourcedLocations } from '@/lib/sourcing/store';
import { classifyCrossSourceMatch, findCrossSourceMatches } from '@/lib/sourcing/parkopediaParse';
import type { CrossSourceCandidate } from './_components/CrossSourceMatchesTable';
import { ParkingSourcingModeView } from './_components/ParkingSourcingModeView';

async function getLocations() {
  try {
    await requireAdmin();
    // includeMerged: false (the default) is correct here — a merged doc's
    // secondary already has a primary, so it should never resurface as a
    // fresh candidate in either table below.
    return await listSourcedLocations({});
  } catch (err) {
    console.error('[parking-sourcing] failed to load sourced locations:', err);
    return [];
  }
}

// spothero is treated as primary and parkopedia as secondary, consistently,
// for every candidate pair — simplest sensible default (Brad didn't specify
// a preference); the "more fields wins" heuristic isn't worth the complexity
// for what's currently a single-city, low-volume probe.
function buildCrossSourceCandidates(locations: Awaited<ReturnType<typeof getLocations>>): CrossSourceCandidate[] {
  const spothero = locations.filter((l) => l.source === 'spothero');
  const parkopedia = locations.filter((l) => l.source === 'parkopedia');
  const byId = new Map(locations.map((l) => [l.id, l]));

  return findCrossSourceMatches(parkopedia, spothero)
    .map((match) => {
      const primary = byId.get(match.spotheroId);
      const secondary = byId.get(match.parkopediaId);
      if (!primary || !secondary) return null;
      return {
        primaryId: primary.id,
        primaryName: primary.name,
        primaryUrl: primary.sourceUrl,
        secondaryId: secondary.id,
        secondaryName: secondary.name,
        secondaryUrl: secondary.sourceUrl,
        distanceMeters: match.distanceMeters,
        addressSimilarity: match.addressSimilarity,
        verdict: classifyCrossSourceMatch(match),
      } satisfies CrossSourceCandidate;
    })
    .filter((c): c is CrossSourceCandidate => c !== null);
}

export default async function ParkingSourcingPage() {
  const locations = await getLocations();
  // Failed-hard-filter records sink to the bottom; createdAt-desc is
  // preserved as the secondary order within both groups — see sortForReview.
  const sortedLocations = sortForReview(locations);
  const crossSourceCandidates = buildCrossSourceCandidates(locations);

  // page.tsx stays the single server-side data-fetcher — ParkingSourcingModeView
  // (client) renders the admin table over the same fetched data, no second fetch.
  return (
    <ParkingSourcingModeView
      locations={locations}
      sortedLocations={sortedLocations}
      crossSourceCandidates={crossSourceCandidates}
    />
  );
}
