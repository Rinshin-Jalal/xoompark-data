'use client';

import { MapPin, Search, Eye, ExternalLink } from 'lucide-react';

// Open-in links (Google Maps / Street View / Google / source URL). All open in
// a new tab. Shared by the detail sheet and the BDR work queue.
export function OpenInLinks({ name, address, lat, lng, sourceUrl }: {
  name: string;
  address: string;
  lat?: string;
  lng?: string;
  sourceUrl?: string;
}) {
  const hasCoords = !!lat && !!lng && !Number.isNaN(parseFloat(lat)) && !Number.isNaN(parseFloat(lng));
  return (
    <div className="open-in-links">
      {hasCoords && (
        <>
          <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer">
            <MapPin size={13} /> Maps
          </a>
          <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`} target="_blank" rel="noreferrer">
            <Eye size={13} /> Street View
          </a>
        </>
      )}
      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${name} ${address}`)}`} target="_blank" rel="noreferrer">
        <Search size={13} /> Google
      </a>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Source
        </a>
      )}
    </div>
  );
}