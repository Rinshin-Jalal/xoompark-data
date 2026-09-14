'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Building2,
  ClipboardList,
  MapPin,
  FlaskConical,
  Mail,
  Phone,
  Archive,
  Users,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import type { Data } from '@/lib/outreach/workflow';
import { isActive } from '@/lib/outreach/workflow';
import { canAccess, type Role } from '@/lib/outreach/roles';
import { DataProvider } from '@/components/outreach/DataContext';
import { DetailProvider } from '@/components/outreach/DetailContext';
import { DetailSheet } from '@/components/outreach/DetailSheet';

const nav = [
  ['/', 'My day', LayoutGrid],
  ['/properties', 'Properties', Building2],
  ['/map', 'Map', MapPin],
  ['/hunt', 'Hunt', MapPin],
  ['/work-queue', 'Work Queue', ClipboardList],
  ['/research-desk', 'Research desk', FlaskConical],
  ['/bdr-email', 'BDR email queue', Mail],
  ['/sdr-call', 'SDR call queue', Phone],
  ['/pipeline', 'Pipeline', ClipboardList],
  ['/site-intelligence', 'Site intelligence', MapPin],
  ['/archived', 'Hidden & archived', Archive],
  ['/team', 'Team & workflow', Users],
] as const;

export function OutreachShell({ data, roles, children }: { data: Data; roles: Role[]; children: React.ReactNode }) {
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
              XOOM<span>PARK</span>
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