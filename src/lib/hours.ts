// Hours formatting for public search. Pure, Firestore-free — runnable
// under plain `node --experimental-strip-types` (see __tests__/hours.test.ts).

/**
 * hoursText comes in two shapes: plain text ("24/7", "Mon-Sun - All day")
 * and raw SpotHero JSON ({"periods":[{first_day,last_day,start_time,...}]}).
 * Plain text passes through; JSON is formatted to "Mon–Fri 7 AM–11 PM".
 * Returns undefined when nothing human-readable can be produced.
 */
export function formatHoursText(text?: string | null): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t.startsWith('{')) return t;

  try {
    const parsed = JSON.parse(t) as {
      periods?: { hours_type?: string; first_day?: string; last_day?: string; start_time?: string; end_time?: string }[];
    };
    const parts = (parsed.periods ?? [])
      .filter((p) => p && p.hours_type !== 'closed')
      .map((p) => {
        const days =
          p.first_day && p.last_day
            ? p.first_day === p.last_day
              ? p.first_day
              : `${p.first_day}–${p.last_day}`
            : null;
        const start = formatClock(p.start_time);
        const end = formatClock(p.end_time);
        return days && start && end ? `${days} ${start}–${end}` : null;
      })
      .filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  } catch {
    return undefined;
  }
}

/** "07:00:00" -> "7 AM" · "13:30:00" -> "1:30 PM" · "00:00:00" -> "12 AM" */
function formatClock(time?: string): string | null {
  const m = String(time ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return m[2] === '00' ? `${h12} ${ampm}` : `${h12}:${m[2]} ${ampm}`;
}
