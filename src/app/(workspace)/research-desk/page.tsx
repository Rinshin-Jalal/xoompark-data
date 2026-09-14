'use client';

import { useData } from '@/components/outreach/DataContext';
import { ResearchDesk } from '@/components/outreach/ResearchDesk';
import { isActive } from '@/lib/outreach/workflow';

export default function ResearchDeskPage() {
  const data = useData();
  return <ResearchDesk leads={data.leads.filter((l) => isActive(l) && ['verify', 'research'].includes(l.stage))} />;
}