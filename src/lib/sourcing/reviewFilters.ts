// Pure filter-predicate logic for the admin sourcing review table's filter
// bar. Deliberately Firestore-free (same split as hardFilters.ts/locality.ts)
// so it's testable with plain `node --experimental-strip-types` and
// importable from both the client filter bar and the client mode view.
import { evaluateHardFilter } from './hardFilters.ts';
import { isInWaymoOdd } from './types.ts';
import type { SourcedParkingLocation } from './types.ts';

export type ReviewSourceFilter = 'all' | 'spothero' | 'parkopedia' | 'laz' | 'manual' | 'other';
export type ReviewStatusFilter = 'all' | 'draft' | 'saved';
export type ReviewHardFilterState = 'all' | 'pass' | 'fail' | 'unknown';
export type ReviewOddFilter = 'all' | 'in' | 'out';
export type ReviewCoordsFilter = 'all' | 'yes' | 'no';

export interface ReviewFilters {
  search: string;
  locality: string | null;
  status: ReviewStatusFilter;
  source: ReviewSourceFilter;
  flood: ReviewHardFilterState;
  residential: ReviewHardFilterState;
  /** Exact match against SourcedParkingLocation.addedBy (free text, no
   * fixed enum like source/status — the filter bar's "All owners" dropdown
   * populates its options from whatever values are actually present). */
  addedBy: string | null;
  /** Default 'in' (not 'all', unlike every other filter here) — Waymo ODD
   * is the lens BD actually works from day to day, same "lens by default"
   * rationale as charging-sites' limitToOdd (see ChargingSitesClient.tsx).
   * A record with no lat/lng yet (isInWaymoOdd returns undefined) reads as
   * neither 'in' nor 'out', so it's hidden by the default too — visible
   * again as soon as 'all' is picked, never deleted. */
  odd: ReviewOddFilter;
  /** Independent of `odd` — 'yes'/'no' isolates by data completeness
   * (has lat/lng at all) rather than geography, e.g. to find the records
   * that still need coordinates. Default 'all' (unlike odd's default
   * 'in') — this is a data-quality lens, not the everyday BD view. */
  hasCoords: ReviewCoordsFilter;
}

export const EMPTY_REVIEW_FILTERS: ReviewFilters = {
  search: '',
  locality: null,
  status: 'all',
  source: 'all',
  flood: 'all',
  residential: 'all',
  addedBy: null,
  odd: 'in',
  hasCoords: 'all',
};

// Sources with their own explicit filter option — anything else buckets to 'other'.
const KNOWN_SOURCES = new Set<ReviewSourceFilter>(['spothero', 'parkopedia', 'laz', 'manual']);

export function applyReviewFilters(
  locations: SourcedParkingLocation[],
  filters: ReviewFilters,
): SourcedParkingLocation[] {
  const search = filters.search.trim().toLowerCase();

  return locations.filter((l) => {
    if (search) {
      const name = (l.name ?? '').toLowerCase();
      const address = (l.address ?? '').toLowerCase();
      if (!name.includes(search) && !address.includes(search)) return false;
    }

    if (filters.locality && l.locality !== filters.locality) return false;

    if (filters.addedBy && l.addedBy !== filters.addedBy) return false;

    if (filters.status !== 'all' && l.status !== filters.status) return false;

    if (filters.source !== 'all') {
      const bucket: ReviewSourceFilter = KNOWN_SOURCES.has(l.source as ReviewSourceFilter)
        ? (l.source as ReviewSourceFilter)
        : 'other';
      if (bucket !== filters.source) return false;
    }

    if (filters.flood !== 'all' && evaluateHardFilter(l, 'aboveFloodPlain').result !== filters.flood) return false;

    if (
      filters.residential !== 'all' &&
      evaluateHardFilter(l, 'notResidentialAdjacent').result !== filters.residential
    ) {
      return false;
    }

    if (filters.odd !== 'all') {
      const inOdd = isInWaymoOdd(l);
      if (filters.odd === 'in' && inOdd !== true) return false;
      if (filters.odd === 'out' && inOdd !== false) return false;
    }

    if (filters.hasCoords !== 'all') {
      const hasCoords = l.lat !== undefined && l.lng !== undefined;
      if (filters.hasCoords === 'yes' && !hasCoords) return false;
      if (filters.hasCoords === 'no' && hasCoords) return false;
    }

    return true;
  });
}

export function hasActiveReviewFilters(filters: ReviewFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.locality !== null ||
    filters.status !== 'all' ||
    filters.source !== 'all' ||
    filters.flood !== 'all' ||
    filters.residential !== 'all' ||
    filters.addedBy !== null ||
    filters.odd !== 'in' ||
    filters.hasCoords !== 'all'
  );
}
