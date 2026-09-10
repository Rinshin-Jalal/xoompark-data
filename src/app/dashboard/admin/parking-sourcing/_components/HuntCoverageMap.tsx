'use client';

// Coverage overview for Hunt's locality picker — a real Google Map so a BDR
// can see, at a glance, which of the Miami-Dade localities are already
// covered and which still need hunting, instead of reading a flat text
// list. Same @vis.gl/react-google-maps pattern as ParkingSourcingMap.tsx and
// SearchMap.tsx.
//
// Locality "boundaries" don't exist as real per-locality data (locality.ts's
// own comment: the doc's landmarks/bounds hints are loose prose, not
// polygons) — so each locality gets a Voronoi cell: the region closer to ITS
// reference point than to any other locality's. d3-delaunay computes this
// exactly, tiling the whole plane with zero gaps/overlaps. But raw Voronoi
// cells are unbounded, and clipping them to a rectangle draws a visible,
// wrong-looking straight edge across the map the moment a BDR zooms out
// (confirmed: a rectangle clip large enough to hide off-screen still shows
// up spanning Orlando to Havana at low zoom). So instead of a rectangle,
// each cell is clipped against MIAMI_DADE_BOUNDARY below — the county's
// REAL outline, fetched from OpenStreetMap (via Nominatim's polygon_geojson,
// osm relation 1210692) — so the only edges ever visible are either a real
// cell-to-cell border or the actual county coastline. Reference points are
// still an approximation (nearest-nameable-point, not an official locality
// boundary, since no such data exists); the outer shape is not.
import { useEffect, useMemo } from 'react';
import intersect from '@turf/intersect';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { Delaunay } from 'd3-delaunay';
import { AdvancedMarker, APIProvider, Map as GoogleMap, Polygon, useMap } from '@vis.gl/react-google-maps';
import { LOCALITY_CENTERS, type LocalityStat } from '@/lib/sourcing/locality';
import { cn } from '@/lib/utils';

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Reference point for each canonical locality — the Voronoi seed each cell
// below is grown from. Shared with locality.ts's own nearest-center lookup
// (deriveLocality) so a lot's assigned locality always agrees with the cell
// its pin visibly lands in here.
const LOCALITY_ORDER = Object.keys(LOCALITY_CENTERS);

// Real Miami-Dade County boundary (OpenStreetMap relation 1210692, fetched
// live via Nominatim's polygon_geojson — not hand-estimated). [lng, lat]
// pairs, closed ring. This is the ONLY outer edge the map ever draws.
const MIAMI_DADE_BOUNDARY: [number, number][] = [
  [-80.8732028, 25.9791962], [-80.87319, 25.363993], [-80.862191, 25.364193], [-80.858167, 25.176513],
  [-80.83754, 25.174541], [-80.82634, 25.160456], [-80.809402, 25.169022], [-80.814674, 25.182564],
  [-80.797856, 25.181223], [-80.801055, 25.143559], [-80.795801, 25.162113], [-80.782213, 25.165273],
  [-80.772749, 25.150586], [-80.777125, 25.13735], [-80.765959, 25.162279], [-80.742923, 25.1426],
  [-80.721839, 25.145183], [-80.747197, 25.158715], [-80.745918, 25.165391], [-80.729908, 25.159759],
  [-80.731704, 25.167443], [-80.72308, 25.161553], [-80.727206, 25.152879], [-80.717329, 25.155387],
  [-80.704062, 25.140415], [-80.697851, 25.162944], [-80.680238, 25.174559], [-80.678066, 25.163938],
  [-80.671694, 25.174583], [-80.669825, 25.167038], [-80.653063, 25.162866], [-80.673092, 25.138594],
  [-80.652277, 25.14658], [-80.65641, 25.154287], [-80.647517, 25.171503], [-80.633723, 25.176239],
  [-80.662443, 25.174975], [-80.651633, 25.192479], [-80.604916, 25.202733], [-80.609583, 25.182846],
  [-80.625158, 25.182544], [-80.614457, 25.175773], [-80.583836, 25.200557], [-80.582374, 25.210551],
  [-80.56548, 25.209581], [-80.57126, 25.198526], [-80.577281, 25.200957], [-80.565368, 25.192618],
  [-80.558546, 25.199303], [-80.561949, 25.212194], [-80.54919, 25.214045], [-80.535837, 25.198923],
  [-80.539634, 25.213512], [-80.519176, 25.222375], [-80.495715, 25.199476], [-80.500586, 25.211346],
  [-80.487215, 25.207126], [-80.494176, 25.227117], [-80.482473, 25.224878], [-80.444205, 25.244199],
  [-80.436272, 25.235762], [-80.41887, 25.23631], [-80.410955, 25.253466], [-80.394931, 25.253537],
  [-80.395081, 25.272937], [-80.379149, 25.287859], [-80.379021, 25.305895], [-80.265472, 25.354296],
  [-80.250874, 25.341991], [-80.150013, 25.31442], [-80.110611, 25.382564], [-80.118576, 25.415501],
  [-80.141757, 25.434711], [-80.126347, 25.474551], [-80.115671, 25.541393], [-80.091947, 25.538988],
  [-80.065809, 25.548176], [-80.043814, 25.579119], [-80.04351, 25.598051], [-80.060238, 25.625383],
  [-80.10368, 25.638171], [-80.094144, 25.66308], [-80.091223, 25.721903], [-80.066872, 25.756733],
  [-80.058654, 25.794312], [-80.056056, 25.837688], [-80.067685, 25.902395], [-80.052257, 25.974956],
  [-80.295187, 25.97057], [-80.2948922, 25.9568442], [-80.680016, 25.956857], [-80.680038, 25.978749],
  [-80.8732028, 25.9791962],
];

// What the map frames on load (see FitBoundsController) — the practical,
// mostly-developed extent of the county (not its official line, which
// stretches deep into the empty Everglades to the west): tight enough that
// a BDR sees the actual hunt-able area first, not miles of swamp.
const MAP_VIEWPORT_BOUNDS: [number, number, number, number] = [-80.42, 25.38, -80.06, 25.98];

// Rectangle the raw Voronoi diagram is computed against — only an
// intermediate step (d3-delaunay needs SOME finite clip to turn infinite
// outer cells into polygons at all), comfortably larger than the county's
// real bounding box so no cell gets truncated before the real clip below
// runs. Every cell is intersected against MIAMI_DADE_BOUNDARY immediately
// after, so this rectangle itself is never what gets drawn.
const VORONOI_SCRATCH_BOUNDS: [number, number, number, number] = [-81, 25, -79.9, 26.1];

function FitBoundsController({ bounds }: { bounds: [number, number, number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const [west, south, east, north] = bounds;
    map.fitBounds({ north, south, east, west });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bounds is a module-level constant, never changes
  }, [map]);
  return null;
}

/** Each locality's Voronoi cell, clipped to the real county boundary, as one
 * or more closed rings (more than one only if the clip splits a cell into
 * disjoint pieces) — computed once from the fixed reference points above,
 * not per-render. */
const LOCALITY_CELL_PARTS: Record<string, { lat: number; lng: number }[][]> = (() => {
  const countyPolygon = turfPolygon([MIAMI_DADE_BOUNDARY]);
  const points: [number, number][] = LOCALITY_ORDER.map((name) => {
    const c = LOCALITY_CENTERS[name];
    return [c.lng, c.lat];
  });
  const voronoi = Delaunay.from(points).voronoi(VORONOI_SCRATCH_BOUNDS);

  const result: Record<string, { lat: number; lng: number }[][]> = {};
  LOCALITY_ORDER.forEach((name, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return;
    const cellPolygon = turfPolygon([cell as unknown as [number, number][]]);
    const clipped = intersect(featureCollection([cellPolygon, countyPolygon]));
    if (!clipped) return;

    const geom = clipped.geometry;
    // Outer ring only per part — holes (a locality's cell fully surrounding
    // a hole in the county shape) aren't a real case here and Google Maps'
    // Polygon would need a second nested array to render them anyway.
    const outerRings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((poly) => poly[0]);
    result[name] = outerRings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
  });
  return result;
})();

type CoverageTier = 'none' | 'needsHunt' | 'covered';

function tierOf(stat: LocalityStat): CoverageTier {
  if (stat.lotCount === 0) return 'none';
  if (stat.needsHunt) return 'needsHunt';
  return 'covered';
}

const TIER_COLOR: Record<CoverageTier, { fill: string; stroke: string }> = {
  none: { fill: '#c1121f', stroke: '#7a1a1a' },
  needsHunt: { fill: '#f0dfa0', stroke: '#8a6d1a' },
  covered: { fill: '#1a5a2a', stroke: '#144a22' },
};

const TIER_LABEL: Record<CoverageTier, string> = {
  none: 'Not started',
  needsHunt: 'Needs hunt',
  covered: 'Covered',
};

// Short label for the on-map pill — text before " / " when the canonical
// name has one (e.g. "Downtown / Central Business District" -> "Downtown").
function shortLabel(locality: string): string {
  return locality.split(' / ')[0];
}

export function HuntCoverageMap({
  stats,
  selected,
  onSelect,
}: {
  stats: LocalityStat[];
  selected: string | null;
  onSelect: (locality: string) => void;
}) {
  const statByLocality = useMemo(() => new Map(stats.map((s) => [s.locality, s])), [stats]);

  return (
    <div className="border border-[#0e1c36]/12 bg-white mb-4">
      <div className="px-3 py-2 border-b border-[#0e1c36]/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0e1c36]/50">
        <span>Nearest-neighborhood zones within the real Miami-Dade County outline — not an official locality boundary.</span>
        <span className="flex items-center gap-3">
          {(['none', 'needsHunt', 'covered'] as const).map((tier) => (
            <span key={tier} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TIER_COLOR[tier].fill }} />
              {TIER_LABEL[tier]}
            </span>
          ))}
        </span>
      </div>
      <div className="h-[560px] w-full">
        <APIProvider apiKey={GMAPS_KEY}>
          <GoogleMap
            defaultCenter={{ lat: 25.63, lng: -80.28 }}
            defaultZoom={10}
            mapId="hunt-coverage-map"
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="h-full w-full"
          >
            <FitBoundsController bounds={MAP_VIEWPORT_BOUNDS} />
            {LOCALITY_ORDER.map((name) => {
              const parts = LOCALITY_CELL_PARTS[name];
              const stat = statByLocality.get(name);
              if (!parts || !stat) return null;
              const tier = tierOf(stat);
              const isSelected = name === selected;
              return parts.map((ring, i) => (
                <Polygon
                  key={`${name}-${i}`}
                  paths={ring}
                  onClick={() => onSelect(name)}
                  fillColor={TIER_COLOR[tier].fill}
                  fillOpacity={isSelected ? 0.55 : 0.32}
                  strokeColor={isSelected ? '#1a3a7a' : TIER_COLOR[tier].stroke}
                  strokeWeight={isSelected ? 3 : 1.5}
                  clickable
                />
              ));
            })}
            {LOCALITY_ORDER.map((name) => {
              const center = LOCALITY_CENTERS[name];
              const stat = statByLocality.get(name);
              if (!stat) return null;
              return (
                <AdvancedMarker key={name} position={center} onClick={() => onSelect(name)}>
                  <span
                    className={cn(
                      'pointer-events-none select-none px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide whitespace-nowrap shadow-sm border',
                      'bg-white/90 border-[#0e1c36]/15 text-[#0e1c36]',
                    )}
                  >
                    {shortLabel(name)} · {stat.lotCount}
                  </span>
                </AdvancedMarker>
              );
            })}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
}
