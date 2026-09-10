// Operator registry + detection. The registry lives in the `operators`
// collection (name, slug, name_patterns, source_mappings) — adding a new
// operator is a data insert, not a code change. Detection priority:
//   1. source mapping (laz.com scraper -> LAZ, by definition)
//   2. name pattern (brand match — patterns deliberately tight so
//      "Ace Hardware" never reads as Ace Parking)
//   3. LBT business license (enrichment.business_license.businessName)
// A manual override (operator_source = 'manual') always wins — detection
// never overwrites an existing operator_id.
import { getAdminFirestore } from '../firebaseAdmin.ts';

export interface OperatorRegistryEntry {
  id: string;
  name: string;
  slug: string;
  name_patterns: string[];
  source_mappings: string[];
}

/** Detection input — the subset of SourcedParkingLocation detection reads. */
export interface OperatorDetectionInput {
  source_name?: string;
  name?: string;
  enrichment?: { business_license?: { businessName?: string } };
}

export type DetectedOperatorSource = 'source' | 'name_pattern' | 'lbt';
export interface DetectedOperator {
  operator_id: string;
  operator_source: DetectedOperatorSource;
}

/**
 * In-memory TTL cache — the registry changes at human speed (same pattern
 * as publicNetwork's cache). ponytail: single-process cache; move to
 * Firestore-level caching if this ever runs multi-instance at high traffic.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; operators: OperatorRegistryEntry[] } | null = null;

export async function loadOperatorRegistry(): Promise<OperatorRegistryEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.operators;
  const db = getAdminFirestore();
  const snap = await db.collection('operators').get();
  const operators = snap.docs.map((d) => d.data() as OperatorRegistryEntry);
  cache = { at: Date.now(), operators };
  return operators;
}

/**
 * Pure detection — no Firestore, testable with plain node. Priority:
 * source mapping -> name pattern -> LBT business name. Returns null when
 * nothing matches (never guesses).
 */
export function detectOperator(
  lot: OperatorDetectionInput,
  registry: OperatorRegistryEntry[],
): DetectedOperator | null {
  if (lot.source_name) {
    for (const op of registry) {
      if (op.source_mappings?.includes(lot.source_name)) {
        return { operator_id: op.id, operator_source: 'source' };
      }
    }
  }
  if (lot.name) {
    for (const op of registry) {
      for (const pattern of op.name_patterns ?? []) {
        if (new RegExp(pattern, 'i').test(lot.name)) {
          return { operator_id: op.id, operator_source: 'name_pattern' };
        }
      }
    }
  }
  const bizName = lot.enrichment?.business_license?.businessName;
  if (bizName) {
    for (const op of registry) {
      if (bizName.toLowerCase().includes(op.slug) || op.name.toLowerCase().includes(bizName.toLowerCase())) {
        return { operator_id: op.id, operator_source: 'lbt' };
      }
    }
  }
  return null;
}

/** id -> display name map, for resolving managedBy in projections. */
export function operatorNameMap(registry: OperatorRegistryEntry[]): Map<string, string> {
  return new Map(registry.map((op) => [op.id, op.name]));
}