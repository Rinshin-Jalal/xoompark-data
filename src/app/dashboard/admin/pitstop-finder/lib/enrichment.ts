import 'server-only';
import { MetroCode } from '@/lib/types';
import { lookupOwner } from '../owners';
import { lookupClosedAtNight } from '../hours';
import { lookupAddress } from '../geocode';
import { ScoredSite } from './finder';

export interface EnrichedSite extends ScoredSite {
  address?: string;
  owner?: string;
  ownerMailing?: string;
  parcelId?: string;
  landUse?: string;
  zoning?: string;
  closedAtNight?: boolean;
}

// Enrich owner-direct candidates with parcel/owner data and hours
export async function enrichSite(site: ScoredSite, metro: MetroCode): Promise<EnrichedSite> {
  const enriched = { ...site } as EnrichedSite;

  // Only enrich owner-direct candidates
  if (!site.ownerDirectCandidate) {
    return enriched;
  }

  // Attempt owner lookup
  try {
    const ownerInfo = await lookupOwner(metro, site.lat, site.lon);
    if (ownerInfo.ownerName) {
      enriched.owner = ownerInfo.ownerName;
      enriched.ownerMailing = ownerInfo.ownerMailingAddress ?? undefined;
      enriched.parcelId = ownerInfo.folio ?? undefined;
      enriched.landUse = ownerInfo.landUse ?? undefined;
      enriched.zoning = ownerInfo.zoning ?? undefined;
    }
  } catch (err) {
    console.debug('[enrichment] owner lookup failed:', err);
  }

  // Attempt hours lookup
  try {
    const hoursResult = await lookupClosedAtNight(site.lat, site.lon);
    if (hoursResult) {
      enriched.closedAtNight = hoursResult.closedAtNight;
      if (hoursResult.hoursText) {
        enriched.openingHours = hoursResult.hoursText;
      }
    }
  } catch (err) {
    console.debug('[enrichment] hours lookup failed:', err);
  }

  // Attempt address lookup
  try {
    const address = await lookupAddress(site.lat, site.lon);
    if (address) {
      enriched.address = address;
    }
  } catch (err) {
    console.debug('[enrichment] address lookup failed:', err);
  }

  return enriched;
}

// Batch enrich multiple sites (rate-limited to avoid hammering APIs)
export async function enrichSites(sites: ScoredSite[], metro: MetroCode, chunkSize: number = 10): Promise<EnrichedSite[]> {
  const enriched: EnrichedSite[] = [];

  for (let i = 0; i < sites.length; i += chunkSize) {
    const chunk = sites.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map((s) => enrichSite(s, metro)));
    enriched.push(...results);
  }

  return enriched;
}
