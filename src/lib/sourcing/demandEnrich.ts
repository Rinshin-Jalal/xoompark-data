import 'server-only';
import { listSourcedLocations, setDemandContext } from './store.ts';
import { computeDemandContext } from './demandDistance.ts';
import { demandZonesConfigHash, DEMAND_ZONES_SCHEMA_VERSION } from './demandZones.ts';

/**
 * Batch-enrich every sourced lot with demand-zone distances (haversine miles
 * to 12 Miami anchor nodes + nearest-zone summary). Idempotent: lots whose
 * stored demand context matches the current configHash + schemaVersion are
 * skipped unless --force. A config change (adding/removing/moving a zone)
 * changes the hash and triggers re-enrichment automatically.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... npm run backfill:demand-zones [-- --force]
 */
export async function enrichDemandZonesBatch(force = false): Promise<{
  enriched: number;
  skipped: number;
  errors: string[];
}> {
  const currentHash = demandZonesConfigHash();
  const all = await listSourcedLocations({ includeMerged: true });
  const errors: string[] = [];
  let enriched = 0;
  let skipped = 0;

  for (const loc of all) {
    if (loc.lat === undefined || loc.lng === undefined) {
      skipped++;
      continue;
    }
    const existing = loc.enrichment?.geo?.demand;
    if (!force && existing?.configHash === currentHash && existing?.schemaVersion === DEMAND_ZONES_SCHEMA_VERSION) {
      skipped++;
      continue;
    }
    try {
      const demand = computeDemandContext(loc.lat, loc.lng);
      await setDemandContext(loc.id, demand);
      enriched++;
    } catch (err) {
      errors.push(`${loc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enriched, skipped, errors };
}
