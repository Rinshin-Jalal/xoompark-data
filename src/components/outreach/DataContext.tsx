'use client';

import { createContext, useContext } from 'react';
import type { Data } from '@/lib/outreach/workflow';
import type { Role } from '@/lib/outreach/roles';

const DataContext = createContext<Data | null>(null);
const RolesContext = createContext<Role[]>(['bdr']);

export function DataProvider({ data, roles, children }: { data: Data; roles: Role[]; children: React.ReactNode }) {
  return (
    <DataContext.Provider value={data}>
      <RolesContext.Provider value={roles}>{children}</RolesContext.Provider>
    </DataContext.Provider>
  );
}

export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData must be used within DataProvider');
  return data;
}

export function useRoles(): Role[] {
  return useContext(RolesContext);
}