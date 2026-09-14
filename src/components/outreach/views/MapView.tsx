'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useData } from '@/components/outreach/DataContext';
import { useDetail } from '@/components/outreach/DetailContext';
import { isActive } from '@/lib/outreach/workflow';

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

export function MapView() {
  const data = useData();
  const { open } = useDetail();
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    // Dynamic import — Leaflet references `window`, so it must load client-side.
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current).setView([25.7617, -80.1918], 11); // Miami default
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // Render markers after the map is ready.
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
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
    };
  }, [data.leads, open]);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> SUPPLY</div>
          <h1>Map.</h1>
          <p>Every lot, colored by stage. Click a pin to open it.</p>
        </div>
      </div>
      <div className="panel">
        <div ref={containerRef} style={{ height: 'calc(100vh - 220px)', minHeight: 420, width: '100%' }} />
      </div>
    </>
  );
}