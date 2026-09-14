import './outreach.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminAuth } from '@/lib/firebaseAdmin';
import { getOutreachData } from '@/lib/outreach/data';
import { OutreachShell } from '@/components/outreach/OutreachShell';
import type { Role } from '@/lib/outreach/roles';

export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  // Real auth gate — session cookie set by /auth on sign-in.
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (!session) redirect('/auth');

  // Read the roles + user info from the session cookie's custom claims.
  let roles: Role[] = [];
  let user: { email: string; name: string } = { email: '', name: '' };
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    roles = (Array.isArray(decoded.roles) ? (decoded.roles as Role[]) : []);
    user = {
      email: decoded.email ?? '',
      name: (decoded.name as string | undefined) ?? decoded.email ?? '',
    };
  } catch {
    redirect('/auth');
  }

  const data = await getOutreachData();
  return (
    <div className="outreach-root">
      <OutreachShell data={data} roles={roles} user={user}>{children}</OutreachShell>
    </div>
  );
}