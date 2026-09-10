// Clearance parsing for public search. Pure, Firestore-free — runnable
// under plain `node --experimental-strip-types` (see __tests__/clearance.test.ts).

/**
 * Parse a clearance string ("8' 2\"", "Height restriction: 6'8\"", "98 inches")
 * into integer inches. Returns undefined when nothing parseable is there —
 * callers must treat that as "unverified", never as "fits".
 */
export function parseClearanceInches(text?: string | null): number | undefined {
  if (!text) return undefined;
  // Feet, optionally followed by inches: 8' 2" / 8'2" / 8'
  const ftIn = text.match(/(\d+)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?/);
  if (ftIn) return Math.round(Number(ftIn[1]) * 12 + (ftIn[2] ? Number(ftIn[2]) : 0));
  // Bare inches: 98" / 98 in / 98 inches
  const inches = text.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b|inch)/i);
  if (inches) return Math.round(Number(inches[1]));
  return undefined;
}
