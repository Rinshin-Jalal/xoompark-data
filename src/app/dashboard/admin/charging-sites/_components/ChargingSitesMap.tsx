'use client';

// Map view for the charging-sites search results — same
// @vis.gl/react-google-maps pattern as ParkingSourcingMap.tsx (pins,
// APIProvider + Map) and HuntCoverageMap.tsx (real-boundary Polygon). The ODD
// overlay is the real fleet service-area boundary from lib/robotaxiServiceAreas.ts.
import { AdvancedMarker, APIProvider, Map, Polygon } from '@vis.gl/react-google-maps';
import type { ChargingSite } from '@/lib/types';
import { isInOdd, isTeslaNetwork, oddZonesFor, type FleetOperator } from '@/lib/odd/odd';

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const FALLBACK_CENTER = { lat: 39.8283, lng: -98.5795 };

export function ChargingSitesMap({
  sites,
  showOdd,
  fleet,
  onSelect,
}: {
  sites: ChargingSite[];
  showOdd: boolean;
  fleet: FleetOperator;
  onSelect: (site: ChargingSite) => void;
}) {
  const center =
    sites.length > 0
      ? { lat: sites.reduce((s, x) => s + x.lat, 0) / sites.length, lng: sites.reduce((s, x) => s + x.lng, 0) / sites.length }
      : FALLBACK_CENTER;

  const zones = oddZonesFor(fleet);

  return (
    <div className="border border-[#0e1c36]/12 bg-white">
      <div className="h-[480px] w-full">
        <APIProvider apiKey={GMAPS_KEY}>
          <Map
            defaultCenter={center}
            defaultZoom={sites.length > 0 ? 10 : 4}
            mapId="charging-sites-map"
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="h-full w-full"
          >
            {showOdd &&
              zones.map((z) => (
                <Polygon
                  key={`${z.provider}-${z.metro}`}
                  paths={z.ring.map(([lng, lat]) => ({ lat, lng }))}
                  fillColor="#2a78d6"
                  fillOpacity={0.08}
                  strokeColor="#2a78d6"
                  strokeOpacity={0.5}
                  strokeWeight={1.5}
                />
              ))}
            {sites.map((s) => (
              <AdvancedMarker key={s.afdcId} position={{ lat: s.lat, lng: s.lng }} onClick={() => onSelect(s)} title={s.name}>
                <span
                  className={
                    'block h-3 w-3 rounded-full border-2 border-white shadow cursor-pointer transition-transform hover:scale-125 ' +
                    (isTeslaNetwork(s.network) ? 'bg-[#c1121f]' : isInOdd(s.lat, s.lng, fleet) ? 'bg-[#1a5a2a]' : 'bg-[#0e1c36]')
                  }
                />
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
      </div>
      <div className="px-3 py-2 border-t border-[#0e1c36]/10 flex flex-wrap items-center gap-4 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/50">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#1a5a2a]" /> In {fleet} ODD</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#c1121f]" /> Tesla network</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0e1c36]" /> Other</span>
      </div>
    </div>
  );
}
