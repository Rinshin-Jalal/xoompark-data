'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Site = Record<string, any>;

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(sites: Site[]): string {
  const cols = Object.keys(sites[0]) as (keyof Site)[];
  const header = cols.join(',');
  const rows = sites.map((s) => cols.map((c) => csvEscape(s[c])).join(','));
  return [header, ...rows].join('\n');
}

function toGeoJson(sites: Site[]) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: sites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'lat' && k !== 'lon')),
    })),
  });
}

export function DownloadButtons({ metro, sites }: { metro: string; sites: Site[] }) {
  if (sites.length === 0) return null;
  const base = `XoomPark_Pitstop_Finder_${metro.toUpperCase()}`;
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => download(`${base}.csv`, toCsv(sites), 'text/csv')}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={() => download(`${base}.geojson`, toGeoJson(sites), 'application/geo+json')}>
        <Download className="h-3.5 w-3.5" /> GeoJSON
      </Button>
    </div>
  );
}
