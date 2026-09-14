'use client';

import { createContext, useContext, useState } from 'react';
import type { Lead } from '@/lib/outreach/workflow';

type DetailContextValue = {
  selected: Lead | null;
  open: (lead: Lead) => void;
  close: () => void;
};

const DetailContext = createContext<DetailContextValue | null>(null);

export function DetailProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Lead | null>(null);
  return (
    <DetailContext.Provider value={{ selected, open: setSelected, close: () => setSelected(null) }}>
      {children}
    </DetailContext.Provider>
  );
}

export function useDetail(): DetailContextValue {
  const ctx = useContext(DetailContext);
  if (!ctx) throw new Error('useDetail must be used within DetailProvider');
  return ctx;
}