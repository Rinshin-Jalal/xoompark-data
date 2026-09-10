import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminAuth } from '@/lib/firebaseAdmin';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;

  if (!session) {
    redirect('/auth?from=/dashboard/admin');
  }

  let isAdmin = false;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    isAdmin = decoded.role === 'admin';
  } catch {
    // Session is invalid or expired
    redirect('/auth?from=/dashboard/admin');
  }

  if (!isAdmin) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
