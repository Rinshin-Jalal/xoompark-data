import 'server-only';
import { cookies } from 'next/headers';
import { getAdminAuth } from '@/lib/firebaseAdmin';

/** Same session-cookie admin check as dashboard/admin/layout.tsx and pipeline/actions.ts. */
export async function requireAdmin(): Promise<{ uid: string; email: string; name: string }> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (!session) throw new Error('Not authenticated');
  const decoded = await getAdminAuth().verifySessionCookie(session, true);
  if (decoded.role !== 'admin') throw new Error('Not authorized');
  return {
    uid: decoded.uid,
    email: decoded.email ?? '',
    name: (decoded.name as string | undefined) ?? decoded.email ?? 'Team',
  };
}
