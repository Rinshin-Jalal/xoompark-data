'use client';

// Map view for the Review Table's Table/Map toggle — same
// @vis.gl/react-google-maps pattern as SearchMap.tsx and the provider
// site-creation map (APIProvider + Map + AdvancedMarker), just pins instead
// of coverage circles. Clicking a pin opens a small docked card (street
// view / google maps / full details) instead of jumping straight to the
// modal — ground-truthing a pin is one click, and "Details" routes to the
// same ViewDetailsPopup the table row click uses, so there's one details
// surface regardless of which view found the record.
import { useState } from 'react';
import { AdvancedMarker, APIProvider, Map } from '@vis.gl/react-google-maps';
import { X } from 'lucide-react';
import type { SourcedParkingLocation } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Miami metro center — every current source is Miami-area, and it's a
// reasonable fallback when nothing in the filtered set has coordinates.
const FALLBACK_CENTER = { lat: 25.7617, lng: -80.1918 };

type PlottableLocation = SourcedParkingLocation & { lat: number; lng: number };

function hasCoords(l: SourcedParkingLocation): l is PlottableLocation {
  return typeof l.lat === 'number' && typeof l.lng === 'number';
}

export function ParkingSourcingMap({
  locations,
  onSelect,
}: {
  locations: SourcedParkingLocation[];
  onSelect: (location: SourcedParkingLocation) => void;
}) {
  const [selected, setSelected] = useState<PlottableLocation | null>(null);
  const plottable = locations.filter(hasCoords);
  const missing = locations.length - plottable.length;

  const center =
    plottable.length > 0
      ? {
          lat: plottable.reduce((sum, l) => sum + l.lat, 0) / plottable.length,
          lng: plottable.reduce((sum, l) => sum + l.lng, 0) / plottable.length,
        }
      : FALLBACK_CENTER;

  return (
    <div className="border border-[#0e1c36]/12 bg-white">
      <div className="px-3 py-2 border-b border-[#0e1c36]/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0e1c36]/50">
        <span>
          {missing > 0 ? `Showing ${plottable.length} of ${locations.length} — ${missing} missing coordinates.` : `${plottable.length} on map.`}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0e1c36]" /> Draft
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#1a5a2a]" /> Saved
          </span>
        </span>
      </div>
      <div className="relative h-[600px] w-full">
        <APIProvider apiKey={GMAPS_KEY}>
          <Map
            defaultCenter={center}
            defaultZoom={plottable.length > 0 ? 11 : 4}
            mapId="parking-sourcing-review-map"
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="h-full w-full"
            onClick={() => setSelected(null)}
          >
            {plottable.map((l) => (
              <AdvancedMarker key={l.id} position={{ lat: l.lat, lng: l.lng }} onClick={() => setSelected(l)} title={l.name}>
                <span
                  className={cn(
                    'block h-3 w-3 rounded-full border-2 border-white shadow cursor-pointer transition-transform hover:scale-125',
                    l.status === 'saved' ? 'bg-[#1a5a2a]' : 'bg-[#0e1c36]',
                    selected?.id === l.id && 'scale-150',
                  )}
                />
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>

        {/* Docked selection card — street view without leaving the map.
            Clicking map background or ✕ clears it. */}
        {selected && (
          <div className="absolute top-3 left-3 z-10 w-72 rounded-lg border border-[#0e1c36]/12 bg-white shadow-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-[#17233A] leading-tight break-words" title={selected.name}>
                {selected.name || 'Sourced location'}
              </p>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="text-[#0e1c36]/40 hover:text-[#0e1c36] shrink-0 -mt-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {selected.address && (
              <p className="text-xs text-[#53627A] mt-1">{selected.address}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selected.lat},${selected.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono font-semibold uppercase tracking-wide text-[#1E477C] hover:underline"
              >
                street view ↗
              </a>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono font-semibold uppercase tracking-wide text-[#1E477C] hover:underline"
              >
                google maps ↗
              </a>
              <button
                onClick={() => onSelect(selected)}
                className="ml-auto px-2.5 py-1 text-[11px] font-mono font-semibold uppercase tracking-wide border border-[#0e1c36]/25 text-[#0e1c36] rounded transition-colors hover:border-[#0e1c36] hover:bg-[#afcbff]"
              >
                Details
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
