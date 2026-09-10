import 'server-only';
import { listSourcedLocations, setDerivedServices } from './store.ts';
import { deriveServicesResources } from './types.ts';

/**
 * Derive services/resources for every sourced lot from enrichment data
 * already on the docs (evContext, pitstopContext, capacity/hours/fence) —
 * the same pass the EV-proximity/pitstop enrichment feeds into, and the
 * one-time backfill (scripts/backfill-services.ts) reuses verbatim.
 *
 * Idempotent: a lot whose derivation already matches what's stored is
 * skipped (no write), so re-running after new enrichment only touches the
 * lots whose inputs actually changed.
 */
export async function enrichServicesBatch(): Promise<{
  derived: number;
  unchanged: number;
  errors: string[];
}> {
  const all = await listSourcedLocations();
  const errors: string[] = [];
  let derived = 0;
  let unchanged = 0;

  for (const loc of all) {
    try {
      const { services, resources } = deriveServicesResources(loc);
      const same = loc.derivedAt
        && (loc.services ?? []).join() === services.join()
        && (loc.resources ?? []).join() === resources.join();
      if (same) {
        unchanged++;
        continue;
      }
      await setDerivedServices(loc.id, services, resources, new Date().toISOString());
      derived++;
    } catch (err) {
      errors.push(`${loc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { derived, unchanged, errors };
}
