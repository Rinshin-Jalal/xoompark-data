import { redirect } from 'next/navigation';

// /login was an older, unused sign-in page (dark theme, email+Google only,
// no phone/signup) — the real flow everywhere else in the app (homepage nav,
// footer, dashboard/admin's own unauthenticated-user redirect) is /auth.
// Kept as a redirect rather than a 404 for any old bookmarks/links.
export default function LoginPage() {
  redirect('/auth');
}
