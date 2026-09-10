import 'server-only';
import { requireAdmin } from '@/lib/requireAdmin';
import { buildBdrQueue } from '@/lib/sourcing/bdrView';
import { listSourcedLocations } from '@/lib/sourcing/store';
import type { SourcedParkingLocation } from '@/lib/sourcing/types';

// Shared by both workspace routes (Work Queue, Hunt) — same fetch the
// single-page workspace used before the split, just factored out so each
// route's page.tsx doesn't repeat it.
export async function getWorkspaceData(): Promise<{
  locations: SourcedParkingLocation[];
  practiceRecord: SourcedParkingLocation | null;
}> {
  try {
    await requireAdmin();
    const locations = await listSourcedLocations({});
    const practiceRecord = buildBdrQueue(locations)[0] ?? null;
    return { locations, practiceRecord };
  } catch (err) {
    console.error('[parking-sourcing/workspace] failed to load data:', err);
    return { locations: [], practiceRecord: null };
  }
}
