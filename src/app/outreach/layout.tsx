import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminAuth } from '@/lib/firebaseAdmin';
import './outreach.css';

export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;

  if (!session) {
    redirect('/auth?from=/outreach');
  }

  let isAdmin = false;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    isAdmin = decoded.role === 'admin';
  } catch {
    redirect('/auth?from=/outreach');
  }

  if (!isAdmin) {
    redirect('/dashboard');
  }

  return <div className="outreach-root">{children}</div>;
}