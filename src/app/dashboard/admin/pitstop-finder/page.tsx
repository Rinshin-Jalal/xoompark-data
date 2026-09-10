import 'server-only';
import { Suspense } from 'react';
import Link from 'next/link';
import { MapPin, Loader2 } from 'lucide-react';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { cn } from '@/lib/utils';
import type { MetroCode, FinderConfig } from '@/lib/types';
import { runFinder } from './lib/finder';
import { DEFAULT_FINDER_CONFIGS } from './lib/config';
import { DownloadButtons } from './_components/DownloadButtons';
import { RefreshButton } from './_components/RefreshButton';
import { ResultsTable } from './_components/ResultsTable';

type SearchParams = Promise<Record<string, string>>;

const getDb = getAdminFirestore;

async function getActiveMetros() {
  try {
    const db = getDb();
    const snapshot = await db.collection('pitstop_configs').get();
    const metros = new Set(snapshot.docs.map((doc) => doc.id));

    // Always include defaults, add any Firestore metros
    const allMetros = new Set([...Object.keys(DEFAULT_FINDER_CONFIGS), ...metros]);
    return Array.from(allMetros);
  } catch {
    return Object.keys(DEFAULT_FINDER_CONFIGS);
  }
}

async function getMetroConfig(metro: MetroCode): Promise<FinderConfig> {
  try {
    const db = getDb();
    const doc = await db.collection('pitstop_configs').doc(metro).get();
    if (doc.exists) {
      return doc.data() as FinderConfig;
    }
  } catch {
    // Firestore unavailable; fall back to hardcoded defaults
  }

  return { ...DEFAULT_FINDER_CONFIGS[metro], created_at: undefined as any, updated_at: undefined as any };
}

function isMetro(v: string | undefined): v is MetroCode {
  const validMetros = ['sf', 'sd', 'miami', 'austin', 'dallas', 'phoenix', 'vegas'];
  return v !== undefined && validMetros.includes(v);
}

async function Results({ metro }: { metro: MetroCode }) {
  let sites: any[] = [];
  try {
    // Load sites from Firestore pitstop_findings collection
    const db = getDb();
    const snapshot = await db.collection('pitstop_findings').where('metro', '==', metro).get();
    // Firestore Timestamps are class instances — RSC can only pass plain objects
    // to the client ResultsTable, so round-trip through JSON to strip them.
    sites = JSON.parse(JSON.stringify(snapshot.docs.map((doc) => doc.data())));

    // Fallback: if no Firestore data, run finder with the metro's config
    if (sites.length === 0) {
      const config = await getMetroConfig(metro);
      sites = await runFinder(metro, config);
    }
  } catch (err) {
    console.error('[pitstop-finder] Results error:', err);
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-[#0e1c36]/40">Couldn&apos;t load results — try again in a moment.</p>
        <p className="text-xs text-[#c1121f] mt-2">{err instanceof Error ? err.message : String(err)}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#0e1c36]/50">{sites.length} sites</p>
        <div className="flex items-center gap-2">
          <RefreshButton metro={metro} />
          <DownloadButtons metro={metro} sites={sites} />
        </div>
      </div>

      <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto">
        {sites.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#0e1c36]/40">No mapped parking facilities found.</p>
        ) : (
          <ResultsTable sites={sites} metro={metro} />
        )}
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex items-center justify-center gap-2 border border-[#0e1c36]/12 bg-white py-16 text-sm text-[#0e1c36]/40">
      <Loader2 className="h-4 w-4 animate-spin" />
      Querying OpenStreetMap for parking facilities — this can take a minute…
    </div>
  );
}

export default async function PitstopFinderPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const metro = isMetro(params.metro) ? params.metro : undefined;
  const activeMetros = await getActiveMetros();

  const tabBase = 'px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.12em] border rounded-md transition-colors';
  const tabActive = 'bg-[#0e1c36] text-[#f9fbf2] border-[#0e1c36]';
  const tabInactive = 'bg-white text-[#0e1c36]/55 border-[#0e1c36]/20 hover:border-[#0e1c36]/50';

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-3.5 w-3.5 text-[#1a3a7a]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40">
            Site Selection
          </span>
        </div>
        <h1 className="text-2xl font-bold text-[#0e1c36]">Pit Stop Finder</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">
          Every mapped parking facility per metro, scored against the site-selection dossier
          (Storage Block + Staging Node). Web version of scripts/finder.py.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {activeMetros.map((m) => {
          if (!isMetro(m)) return null;
          const metroName = DEFAULT_FINDER_CONFIGS[m]?.name || m.toUpperCase();
          return (
            <Link
              key={m}
              href={`/dashboard/admin/pitstop-finder?metro=${m}`}
              className={cn(tabBase, metro === m ? tabActive : tabInactive)}
            >
              {metroName}
            </Link>
          );
        })}
      </div>

      {metro ? (
        <Suspense key={metro} fallback={<ResultsSkeleton />}>
          <Results metro={metro} />
        </Suspense>
      ) : (
        <div className="border border-[#0e1c36]/12 bg-white py-16 text-center text-sm text-[#0e1c36]/40">
          Pick a metro to run the finder.
        </div>
      )}
    </div>
  );
}
