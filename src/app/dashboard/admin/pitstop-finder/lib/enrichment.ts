import 'server-only';
import { MetroCode } from '@/lib/types';
import { lookupOwner } from '../owners';
import { lookupClosedAtNight } from '../hours';
import { lookupAddress } from '../geocode';
import { ScoredSite } from './finder';

export interface EnrichedSite extends ScoredSite {
  address?: string;
  owner?: string;
  owner_mailing_address?: string;
  parcel_id?: string;
  land_use_code?: string;
  zoning_code?: string;
  is_closed_at_night?: boolean;
}

// Enrich owner-direct candidates with parcel/owner data and hours
export async function enrichSite(site: ScoredSite, metro_id: MetroCode): Promise<EnrichedSite> {
  const enriched = { ...site } as EnrichedSite;

  // Only enrich owner-direct candidates
  if (!site.is_owner_direct_candidate) {
    return enriched;
  }

  // Attempt owner lookup
  try {
    const ownerInfo = await lookupOwner(metro_id, site.lat, site.lng);
    if (ownerInfo.ownerName) {
      enriched.owner = ownerInfo.ownerName;
      enriched.owner_mailing_address = ownerInfo.owner_mailing_addressAddress ?? undefined;
      enriched.parcel_id = ownerInfo.folio ?? undefined;
      enriched.land_use_code = ownerInfo.land_use_code ?? undefined;
      enriched.zoning_code = ownerInfo.zoning_code ?? undefined;
    }
  } catch (err) {
    console.debug('[enrichment] owner lookup failed:', err);
  }

  // Attempt hours lookup
  try {
    const hoursResult = await lookupClosedAtNight(site.lat, site.lng);
    if (hoursResult) {
      enriched.is_closed_at_night = hoursResult.is_closed_at_night;
      if (hoursResult.hours_text) {
        enriched.opening_hours = hoursResult.hours_text;
      }
    }
  } catch (err) {
    console.debug('[enrichment] hours lookup failed:', err);
  }

  // Attempt address lookup
  try {
    const address = await lookupAddress(site.lat, site.lng);
    if (address) {
      enriched.address = address;
    }
  } catch (err) {
    console.debug('[enrichment] address lookup failed:', err);
  }

  return enriched;
}

// Batch enrich multiple sites (rate-limited to avoid hammering APIs)
export async function enrichSites(sites: ScoredSite[], metro_id: MetroCode, chunkSize: number = 10): Promise<EnrichedSite[]> {
  const enriched: EnrichedSite[] = [];

  for (let i = 0; i < sites.length; i += chunkSize) {
    const chunk = sites.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map((s) => enrichSite(s, metro_id)));
    enriched.push(...results);
  }

  return enriched;
}
