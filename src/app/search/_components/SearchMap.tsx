'use client';

import { Map as GoogleMap, Circle, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PublicSite } from '@/lib/publicNetwork';
import { DEMO_SITE_ID } from './locked';
import { LockedValue } from './locked';

// Muted basemap in our palette — land near the page off-white, water in our
// cyan, POI/transit noise off. The coverage circles become the most
// saturated things on screen instead of competing with Google's colors.
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f1f1ec' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f1f1ec' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8f98' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d7f9ff' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8aa8b8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f8e9c8' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e3ede3' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// Below this zoom, individual circles overlap into mush — cluster instead.
const CLUSTER_MAX_ZOOM = 12;
// Grid cell size in world pixels at the current zoom.
const CLUSTER_CELL_PX = 110;
const EARTH_RADIUS_M = 6371000;

function MapController({ center, zoom }: { center: { lat: number; lng: number } | null; zoom: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (map && center) {
      map.panTo(center);
      if (zoom) map.setZoom(zoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, center?.lat, center?.lng, zoom]);
  return null;
}

// Picking a site from the list should bring its pin into view too, not just
// open the detail sheet - pans/zooms independently of the location-search
// controller above so either path can move the map.
function SelectionController({ site }: { site: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (map && site) {
      map.panTo(site);
      if ((map.getZoom() ?? 0) < 13) map.setZoom(13);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, site?.lat, site?.lng]);
  return null;
}

/** Reports the map's live zoom so circles/clusters can react to it. */
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('zoom_changed', () => {
      const z = map.getZoom();
      if (z !== undefined) onZoom(z);
    });
    return () => listener.remove();
  }, [map, onZoom]);
  return null;
}

interface Cluster {
  lat: number;
  lng: number;
  /** Meters from centroid to the farthest member, padded for visibility. */
  radiusM: number;
  count: number;
}

/** Grid clustering in world-pixel space — cheap, deterministic, no deps. */
function clusterSites(sites: PublicSite[], zoom: number): Cluster[] {
  const z = Math.max(0, Math.floor(zoom));
  const worldSize = 256 * 2 ** z;
  const lngToX = (lng: number) => ((lng + 180) / 360) * worldSize;
  const latToY = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize;
  };

  const cells = new Map<string, PublicSite[]>();
  for (const site of sites) {
    const key = `${Math.floor(lngToX(site.lng) / CLUSTER_CELL_PX)}:${Math.floor(latToY(site.lat) / CLUSTER_CELL_PX)}`;
    const list = cells.get(key) ?? [];
    list.push(site);
    cells.set(key, list);
  }

  return Array.from(cells.values(), (members) => {
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
    // Farthest member from the centroid, via haversine.
    let maxM = 0;
    for (const m of members) {
      const dLat = ((m.lat - lat) * Math.PI) / 180;
      const dLng = ((m.lng - lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((m.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      maxM = Math.max(maxM, 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
    }
    // Pad so the cluster visually contains its members, and keep a ~28px
    // minimum on screen at this zoom so small clusters stay visible.
    const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const radiusM = Math.max(maxM + 400, 28 * mPerPx);
    return { lat, lng, radiusM, count: members.length };
  });
}

/** Scale-based rounding: 1610 -> "1.6k+", 633 -> "630+", 12 stays exact.
 *  Cluster cells are approximate geography — a precise count would read as
 *  exact inventory, which it isn't. */
function formatClusterCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k+`;
  if (count >= 100) return `${Math.round(count / 10) * 10}+`;
  return String(count);
}

/** Cluster count pill — an aggregate, not a location, so it exposes nothing. */
function ClusterMarker({ cluster, onSelect }: { cluster: Cluster; onSelect: () => void }) {
  return (
    <AdvancedMarker position={{ lat: cluster.lat, lng: cluster.lng }} onClick={onSelect}>
      <div
        className="flex items-center justify-center rounded-full border-2 border-white bg-[#0e1c36] px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-md"
        style={{ cursor: 'pointer' }}
      >
        {formatClusterCount(cluster.count)}
      </div>
    </AdvancedMarker>
  );
}

export function SearchMap({
  sites,
  selectedSiteId,
  popupSiteId,
  onClosePopup,
  onSelectSite,
  center,
  zoom,
}: {
  sites: PublicSite[];
  selectedSiteId: string | null;
  popupSiteId: string | null;
  onClosePopup: () => void;
  onSelectSite: (siteId: string) => void;
  center: { lat: number; lng: number } | null;
  zoom: number | null;
}) {
  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;
  const popupSite = sites.find((s) => s.id === popupSiteId) ?? null;

  // City/metro view: all sites within ~80km of their centroid opens at city
  // zoom on the centroid; anything wider (the full /search network) opens on
  // the whole US. Geographic, not name-based — a metro page spans several
  // city labels but is still one metro.
  const centroid = sites.length > 0
    ? { lat: sites.reduce((s, x) => s + x.lat, 0) / sites.length, lng: sites.reduce((s, x) => s + x.lng, 0) / sites.length }
    : null;
  const metroView =
    centroid !== null &&
    sites.every((s) => {
      const dLat = ((s.lat - centroid.lat) * Math.PI) / 180;
      const dLng = ((s.lng - centroid.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((centroid.lat * Math.PI) / 180) * Math.cos((s.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return 6371 * 2 * Math.asin(Math.sqrt(a)) <= 80;
    });
  const defaultCenter = center ?? (metroView && centroid ? centroid : { lat: 39.8283, lng: -98.5795 });
  const initialZoom = zoom ?? (metroView ? 11 : 4);

  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const liveZoom = zoomLevel ?? initialZoom;

  // Clustered view below CLUSTER_MAX_ZOOM; individual circles above, where
  // the stored radius (300-400m) is the minimum size and scales up 2x per
  // zoom-out level (capped 8x) so areas stay visible.
  const clustering = liveZoom < CLUSTER_MAX_ZOOM;
  const scale = Math.min(8, Math.max(1, 2 ** (13 - liveZoom)));
  const clusters = useMemo(
    () => (clustering ? clusterSites(sites, liveZoom) : []),
    [clustering, sites, liveZoom]
  );

  return (
    <div className="relative h-full w-full">
      <GoogleMap
        defaultCenter={defaultCenter}
        defaultZoom={initialZoom}
        mapId="search-map"
        gestureHandling="greedy"
        disableDefaultUI={false}
        styles={MAP_STYLE}
        className="h-full w-full"
      >
        <MapController center={center} zoom={zoom} />
        <ZoomWatcher onZoom={setZoomLevel} />
        <SelectionController site={selectedSite ? { lat: selectedSite.lat, lng: selectedSite.lng } : null} />

        {clustering ? (
          <>
            {clusters.map((c) => (
              <Circle
                key={`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`}
                center={{ lat: c.lat, lng: c.lng }}
                radius={c.radiusM}
                strokeColor="#0e1c36"
                strokeOpacity={0.6}
                strokeWeight={1.25}
                fillColor="#1a3a7a"
                fillOpacity={0.15}
                clickable={false}
              />
            ))}
            <ClusterZoomController clusters={clusters} />
          </>
        ) : (
          /* The circles ARE the pins — one unified look, no type split, and
             no center-point marker that would imply a precise location. */
          sites.map((site) => {
            const selected = site.id === selectedSiteId;
            return (
              <Circle
                key={site.id}
                center={{ lat: site.lat, lng: site.lng }}
                radius={site.radiusM * scale}
                onClick={() => onSelectSite(site.id)}
                strokeColor={selected ? '#0e1c36' : '#1a3a7a'}
                strokeOpacity={selected ? 1 : 0.75}
                strokeWeight={selected ? 2.5 : 1.25}
                fillColor={selected ? '#0e1c36' : '#1a3a7a'}
                fillOpacity={selected ? 0.22 : 0.13}
                clickable
              />
            );
          })
        )}

        {/* Selection halo — a larger, near-transparent ring behind the
            selected circle so it pops without heavy fill. */}
        {selectedSite && !clustering && (
          <Circle
            center={{ lat: selectedSite.lat, lng: selectedSite.lng }}
            radius={selectedSite.radiusM * scale * 1.9}
            strokeColor="#0e1c36"
            strokeOpacity={0.25}
            strokeWeight={1}
            fillColor="#0e1c36"
            fillOpacity={0.04}
            clickable={false}
          />
        )}

        {/* Popup — facts only (type, clearance, capacity, hours, features).
            No name, no address: the circle is already privacy-fuzzed, the
            popup must not out-detail it. A-level fields (name, exact
            location, rates) are locked except on the demo site. */}
        {popupSite && !clustering && (() => {
          const locked = popupSite.source === 'sourcing' && popupSite.id !== DEMO_SITE_ID;
          return (
          <InfoWindow
            position={{ lat: popupSite.lat, lng: popupSite.lng }}
            onCloseClick={onClosePopup}
            headerContent={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[#0e1c36]/40">{popupSite.name ?? `Site ${popupSite.label ?? popupSite.city}`}</span>
                {!locked && popupSite.source === 'sourcing' && (
                  <span className="rounded-full bg-[#1a3a7a]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#1a3a7a]">Sample location</span>
                )}
              </span>
            }
          >
            <div className="max-w-[240px] py-1 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {popupSite.surfaceType && (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
                    {popupSite.surfaceType === 'structured' ? 'Garage' : 'Surface lot'}
                  </span>
                )}
                {popupSite.clearanceInches != null && (
                  <span className={`text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${popupSite.clearanceInches >= 96 ? 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]' : 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60'}`}>
                    {Math.floor(popupSite.clearanceInches / 12)}&prime;{popupSite.clearanceInches % 12}&Prime;{popupSite.clearanceInches >= 96 ? ' · fits 8&prime; vehicle' : ''}
                  </span>
                )}
                {popupSite.access247 && (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
                    24/7 access
                  </span>
                )}
                {popupSite.fenced && (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
                    Fenced
                  </span>
                )}
                {popupSite.lit && (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
                    Lit
                  </span>
                )}
                {popupSite.evContext?.onSiteDcFastPorts ? (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]">
                    ⚡ {popupSite.evContext.onSiteDcFastPorts} DC on-site
                  </span>
                ) : popupSite.evContext?.nearestDcFastMi != null ? (
                  <span
                    className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60"
                    title={popupSite.evContext.nearestNetwork ?? undefined}
                  >
                    DC {popupSite.evContext.nearestDcFastMi}mi away
                  </span>
                ) : null}
                {popupSite.floodZone && (
                  <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#ffe1e1]/60 border-[#ffcccc] text-[#7a1a1a]">
                    Flood zone {popupSite.floodZone}
                  </span>
                )}
                {locked && <LockedValue label="Exact location" />}
              </div>
              <div className="text-xs text-[#0e1c36]/70 space-y-0.5">
                {popupSite.stallsTotal != null && (
                  <div>{popupSite.stallsTotal.toLocaleString()} stalls</div>
                )}
                {locked ? <LockedValue label="Rates" /> : popupSite.priceText && <div>{popupSite.priceText}</div>}
                {popupSite.hoursText && <div>{popupSite.hoursText}</div>}
                {popupSite.gateType && <div className="capitalize">{popupSite.gateType} gate</div>}
                {popupSite.ingressEgress && <div className="capitalize">{popupSite.ingressEgress} ingress/egress</div>}
                {popupSite.serviceTypes.length > 0 && (
                  <div className="text-[#0e1c36]/50">{popupSite.serviceTypes.join(' · ')}</div>
                )}
                {popupSite.resourceTypes.length > 0 && (
                  <div className="text-[#0e1c36]/50">{popupSite.resourceTypes.join(' · ')}</div>
                )}
              </div>
            </div>
          </InfoWindow>
          );
        })()}
      </GoogleMap>

      {/* Lead-gen: a filtered search that finds nothing is a dead end —
          turn it into a sourcing request instead. */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-lg border border-[#0e1c36]/12 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
        <span className="text-[11px] text-[#0e1c36]/60">Don&rsquo;t see the right location?</span>
        <Link
          href="/auth"
          className="flex items-center gap-1 text-[11px] font-semibold text-[#1a3a7a] hover:text-[#0e1c36]"
        >
          Request a location <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Renders the count pills and handles zoom-in on cluster click. */
function ClusterZoomController({ clusters }: { clusters: Cluster[] }) {
  const map = useMap();
  return (
    <>
      {clusters.map((c) => (
        <ClusterMarker
          key={`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`}
          cluster={c}
          onSelect={() => {
            if (!map) return;
            map.panTo({ lat: c.lat, lng: c.lng });
            map.setZoom(Math.min(16, Math.floor(map.getZoom() ?? 4) + 2));
          }}
        />
      ))}
    </>
  );
}
