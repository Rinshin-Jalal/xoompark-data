import 'server-only';
import { Zap } from 'lucide-react';
import { listSavedChargingLocations } from './actions';
import { ChargingSitesClient } from './_components/ChargingSitesClient';

async function getSavedLocations() {
  try {
    return await listSavedChargingLocations();
  } catch (err) {
    console.error('[charging-sites] failed to load saved locations:', err);
    return [];
  }
}

export default async function ChargingSitesPage() {
  const saved = await getSavedLocations();

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-3.5 w-3.5 text-[#1a3a7a]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40">
            Site Selection
          </span>
        </div>
        <h1 className="text-2xl font-bold text-[#0e1c36]">Charging Sites</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">
          DC fast charging stations from the US DOE&apos;s AFDC dataset. Save the ones the team is
          pursuing, track garage clearance ourselves — AFDC doesn&apos;t carry it.
        </p>
      </div>

      <ChargingSitesClient initialSaved={saved} />
    </div>
  );
}
