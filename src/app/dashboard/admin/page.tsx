import 'server-only';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { MapPin, Zap, Search, FileText, Database, Building2 } from 'lucide-react';

async function getAggregatedStats() {
  const db = getAdminFirestore();
  try {
    const [sourcedLots, chargingSites, siteFindings, fleetFeedback, prospects] = await Promise.all([
      db.collection('sourcedParkingLocations').count().get(),
      db.collection('savedChargingLocations').count().get(),
      db.collection('siteFindings').count().get(),
      db.collection('fleetFeedback').count().get(),
      db.collection('bdProspects').count().get(),
    ]);
    return {
      sourcedLots: sourcedLots.data().count,
      chargingSites: chargingSites.data().count,
      siteFindings: siteFindings.data().count,
      fleetFeedback: fleetFeedback.data().count,
      prospects: prospects.data().count,
    };
  } catch {
    return { sourcedLots: 0, chargingSites: 0, siteFindings: 0, fleetFeedback: 0, prospects: 0 };
  }
}

const STAT_CARDS = [
  { key: 'sourcedLots' as const, label: 'Sourced Lots', icon: MapPin },
  { key: 'chargingSites' as const, label: 'Charging Sites', icon: Zap },
  { key: 'siteFindings' as const, label: 'Pitstop Findings', icon: Search },
  { key: 'fleetFeedback' as const, label: 'Fleet Feedback', icon: FileText },
  { key: 'prospects' as const, label: 'BD Prospects', icon: Building2 },
];

export default async function AdminPage() {
  const stats = await getAggregatedStats();

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Database className="h-3.5 w-3.5 text-[#1a3a7a]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40">
            Aggregated Data
          </span>
        </div>
        <h1 className="text-2xl font-bold text-[#0e1c36]">Data Overview</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">
          Sourcing, enrichment, and fleet data — aggregated database.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="border border-[#0e1c36]/12 bg-white p-5">
            <Icon className="h-5 w-5 text-[#1a3a7a] mb-3" />
            <p className="text-2xl font-bold tabular-nums text-[#0e1c36]">{stats[key]}</p>
            <p className="font-mono text-[10px] uppercase tracking-[.1em] text-[#0e1c36]/50 mt-1">
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
