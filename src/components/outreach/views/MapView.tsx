'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { useData } from '@/components/outreach/DataContext';
import { useDetail } from '@/components/outreach/DetailContext';
import { isActive } from '@/lib/outreach/workflow';
import { FLEET_OPERATORS, FLEET_LABEL, oddZonesFor } from '@/lib/odd/odd';
import type { FleetOperator } from '@/lib/odd/odd';

// Stage → pin color (muted gray → green → dark green as the lot progresses).
const STAGE_COLORS: Record<string, string> = {
  research: '#9ca3af',
  verify: '#60a5fa',
  ready: '#f59e0b',
  email_followup: '#f59e0b',
  email_reply: '#f59e0b',
  sdr: '#8b5cf6',
  followup: '#8b5cf6',
  qualified: '#3b7a57',
  hold: '#6b6868',
};

// ODD (robotaxi service-area) boundary colors per fleet.
const FLEET_COLORS: Record<FleetOperator, string> = {
  waymo: '#3b7a57',
  tesla: '#b63232',
  zoox: '#8b5cf6',
};

export function MapView() {
  const data = useData();
  const { open } = useDetail();
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showOdd, setShowOdd] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Dynamic import — Leaflet references `window`, so it must load client-side.
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      // Reuse the map across re-renders (ODD toggle) to avoid flicker.
      let map = mapRef.current;
      if (!map) {
        map = L.map(containerRef.current).setView([25.7617, -80.1918], 11); // Miami default
        mapRef.current = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map);
      }

      // Clear dynamic layers (markers + ODD polygons) before re-adding.
      map.eachLayer((layer) => {
        if (layer instanceof L.Marker || layer instanceof L.Polygon) layer.remove();
      });

      // Render markers.
      const withCoords = data.leads.filter((l) => isActive(l) && l.raw.lat && l.raw.lng);
      for (const l of withCoords) {
        const lat = parseFloat(l.raw.lat);
        const lng = parseFloat(l.raw.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

        const color = STAGE_COLORS[l.stage] ?? '#9ca3af';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map!);
        marker.on('click', () => open(l));
        marker.bindTooltip(l.raw.name, { direction: 'top', offset: [0, -8] });
      }

      // ODD overlay — robotaxi service-area boundaries.
      if (showOdd) {
        for (const fleet of FLEET_OPERATORS) {
          for (const zone of oddZonesFor(fleet)) {
            L.polygon(zone.ring.map(([lng, lat]) => [lat, lng] as [number, number]), {
              color: FLEET_COLORS[fleet],
              weight: 1.5,
              fillOpacity: 0.08,
            })
              .addTo(map!)
              .bindTooltip(`${FLEET_LABEL[fleet]} · ${zone.metro}`);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data.leads, open, showOdd]);

  // Remove the map on unmount only (not on deps change — we reuse it).
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> SUPPLY</div>
          <h1>Map.</h1>
          <p>Every lot, colored by stage. Click a pin to open it.</p>
        </div>
        <button
          onClick={() => setShowOdd((v) => !v)}
          className={`px-4 py-2 text-sm rounded-md border transition-colors duration-150 ${
            showOdd
              ? 'bg-[#3b7a57] text-white border-[#3b7a57]'
              : 'border-[#e5e3e3] text-[#171717] hover:bg-[#f5f4f4]'
          }`}
        >
          {showOdd ? 'Hide ODD overlay' : 'Show ODD overlay'}
        </button>
      </div>
      <div className="panel">
        <div ref={containerRef} style={{ height: 'calc(100vh - 220px)', minHeight: 420, width: '100%' }} />
      </div>
    </>
  );
}