// Role definitions + nav gating. Roles gate what each user sees:
//   admin      — everything + user management
//   bdr        — Work Queue, Research Desk, BDR Email (no SDR/Pipeline)
//   sdr        — SDR Call, Pipeline (no Work Queue/BDR Email)
//   researcher — Hunt, Research Desk
export type Role = 'admin' | 'bdr' | 'sdr' | 'researcher';

export const ROLES: Role[] = ['admin', 'bdr', 'sdr', 'researcher'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  bdr: 'BDR',
  sdr: 'SDR',
  researcher: 'Researcher',
};

// Which routes each role can see. The sidebar nav and the layout gate both
// read from this.
export const ROLE_ROUTES: Record<Role, string[]> = {
  admin: ['/', '/properties', '/map', '/hunt', '/work-queue', '/research-desk', '/bdr-email', '/sdr-call', '/pipeline', '/site-intelligence', '/archived', '/team'],
  bdr: ['/', '/properties', '/map', '/work-queue', '/research-desk', '/bdr-email'],
  sdr: ['/', '/properties', '/map', '/sdr-call', '/pipeline'],
  researcher: ['/', '/properties', '/map', '/hunt', '/research-desk'],
};

export function canAccess(roles: Role[], path: string): boolean {
  if (roles.length === 0) return false;
  if (roles.includes('admin')) return true; // admin sees everything
  return roles.some((role) => {
    const allowed = ROLE_ROUTES[role] ?? [];
    return allowed.some((r) => r === path || (r !== '/' && path.startsWith(r)));
  });
}