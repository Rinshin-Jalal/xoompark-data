import './outreach.css';

// ponytail: no auth gate here — the Firestore reads go through the admin SDK
// (service account), not the user session, so the page renders with real data
// without bouncing through the old /auth screen. Re-add the session-cookie
// check from dashboard/admin/layout.tsx when this becomes a gated surface.
export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return <div className="outreach-root">{children}</div>;
}