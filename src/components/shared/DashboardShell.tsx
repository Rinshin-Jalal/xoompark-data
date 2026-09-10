'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  KeyRound, FileText, LayoutDashboard,
  MapPin, LogOut, Activity, Zap, Shield, TrendingUp, ParkingSquare, MapPinned,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { signOutAction } from '@/lib/authActions';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider,
  SidebarSeparator, SidebarTrigger,
} from '@/components/ui/sidebar';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string }[];
}

const adminNav: NavItem[] = [
  { label: 'Overview', href: '/dashboard/admin', icon: LayoutDashboard },
  { label: 'BD Pipeline', href: '/dashboard/admin/pipeline', icon: TrendingUp },
];

const siteSelectionNav: NavItem[] = [
  { label: 'Pit Stop Finder', href: '/dashboard/admin/pitstop-finder', icon: ParkingSquare, children: [{ label: 'Config', href: '/dashboard/admin/pitstop-finder/config' }] },
  { label: 'Charging Sites', href: '/dashboard/admin/charging-sites', icon: Zap, children: [{ label: 'Coverage', href: '/dashboard/admin/charging-sites/coverage' }] },
  { label: 'Parking Sourcing', href: '/dashboard/admin/parking-sourcing', icon: MapPinned },
  { label: 'Fleet Keys', href: '/dashboard/admin/fleet-keys', icon: KeyRound },
];

function NavMenuItem({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
        <Link href={item.href}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {item.children && (
        <SidebarMenuSub>
          {item.children.map((child) => (
            <SidebarMenuSubItem key={child.href}>
              <SidebarMenuSubButton asChild isActive={pathname === child.href}>
                <Link href={child.href}>
                  <span>{child.label}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await signOutAction();
    router.push('/');
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <Zap className="text-[#1a3a7a]" />
                <span className="font-bold tracking-[.14em] text-sm">XOOMPARK</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/dashboard'} tooltip="Home">
                <Link href="/dashboard">
                  <Activity />
                  <span>Home</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel><Shield className="mr-1.5" />Admin</SidebarGroupLabel>
            <SidebarMenu>
              {adminNav.map((item) => <NavMenuItem key={item.href} item={item} />)}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel><MapPin className="mr-1.5" />Site Selection</SidebarGroupLabel>
            <SidebarMenu>
              {siteSelectionNav.map((item) => <NavMenuItem key={item.href} item={item} />)}
            </SidebarMenu>
          </SidebarGroup>
        )}

      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter>
        <div className="flex items-center gap-3 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0e1c36] text-sm font-bold text-[#f9fbf2]">
            {(user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#0e1c36] truncate">{user?.displayName ?? 'User'}</p>
            <p className="text-xs text-[#0e1c36]/45 truncate">{user?.email}</p>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign Out">
              <LogOut />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="bg-[#f9fbf2]">
        <header className="print:hidden flex items-center gap-3 border-b border-[#0e1c36]/12 bg-white px-4 py-3 md:hidden">
          <SidebarTrigger />
          <span className="font-mono text-sm font-bold tracking-[.14em] text-[#0e1c36]">XOOMPARK</span>
        </header>
        <div className="print:hidden hidden md:flex items-center border-b border-[#0e1c36]/12 bg-white px-4 py-2">
          <SidebarTrigger />
        </div>
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className="p-6">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
