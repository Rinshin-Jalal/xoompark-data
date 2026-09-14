'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Building2,
  ClipboardList,
  Map,
  Compass,
  FlaskConical,
  Mail,
  Phone,
  Archive,
  Users,
  BarChart3,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import type { Data } from '@/lib/outreach/workflow';
import { isActive } from '@/lib/outreach/workflow';
import { canAccess, ROLE_LABELS, type Role } from '@/lib/outreach/roles';
import { signOutAction } from '@/lib/authActions';
import { DataProvider } from '@/components/outreach/DataContext';
import { DetailProvider } from '@/components/outreach/DetailContext';
import { DetailSheet } from '@/components/outreach/DetailSheet';

const nav = [
  ['/', 'My day', LayoutGrid],
  ['/properties', 'Properties', Building2],
  ['/map', 'Map', Map],
  ['/source', 'Source', Compass],
  ['/work-queue', 'Work Queue', ClipboardList],
  ['/research-desk', 'Research desk', FlaskConical],
  ['/bdr-email', 'BDR email queue', Mail],
  ['/sdr-call', 'SDR call queue', Phone],
  ['/pipeline', 'Pipeline', ClipboardList],
  ['/site-intelligence', 'Site intelligence', BarChart3],
  ['/archived', 'Hidden & archived', Archive],
  ['/team', 'Team & workflow', Users],
] as const;

export function OutreachShell({ data, roles, user, children }: { data: Data; roles: Role[]; user: { email: string; name: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const activeCount = data.leads.filter(isActive).length;

  // Filter nav by roles — SDRs don't see BDR stuff, BDRs don't see SDR stuff.
  const visibleNav = nav.filter(([href]) => canAccess(roles, href));

  // No roles yet — waiting for an admin to assign them.
  if (roles.length === 0) {
    return (
      <DataProvider data={data} roles={roles}>
        <div className="min-h-screen flex items-center justify-center bg-[#fdfcfc]">
          <div className="text-center max-w-sm">
            <div className="logo justify-center mb-4" style={{ display: 'flex' }}>
              XOOM<span>PARK</span>
            </div>
            <h1 className="text-xl font-light text-[#171717] mb-2">Waiting for access</h1>
            <p className="text-sm text-[#6b6868]">Your account is set up, but no roles are assigned yet. An admin will grant you access.</p>
          </div>
        </div>
      </DataProvider>
    );
  }

  return (
    <DataProvider data={data} roles={roles}>
      <DetailProvider>
        <SidebarProvider style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
        <Sidebar className="xp-sidebar">
          <SidebarHeader>
            <div className="logo">
              xoompark<span> workspace</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <div className="nav-caption">WORKSPACE</div>
            <SidebarMenu>
              {visibleNav.map(([href, label, Icon]) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={pathname === href} className="nav-link">
                    <Link href={href}>
                      <Icon />
                      <span>{label}</span>
                      {href === '/properties' && <small>{activeCount}</small>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter>
            <div className="profile">
              <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#171717]">{user.name}</p>
                <p className="truncate text-xs text-[#6b6868]">{user.email}</p>
                <p className="text-[10px] text-[#3b7a57] mt-0.5">{roles.map((r) => ROLE_LABELS[r]).join(' · ')}</p>
              </div>
              <button onClick={() => signOutAction()} className="ml-auto text-xs text-[#6b6868] hover:text-[#171717]">Sign out</button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="xp-main">
          <header className="topbar">
            <div className="breadcrumbs">
              <SidebarTrigger />
              <strong>{visibleNav.find((n) => n[0] === pathname)?.[1] ?? 'Workspace'}</strong>
            </div>
          </header>
          <main className="content">{children}</main>
        </SidebarInset>
        <DetailSheet />
      </SidebarProvider>
      </DetailProvider>
    </DataProvider>
  );
}