'use client';

import { useData } from '@/components/outreach/DataContext';
import { SdrCall } from '@/components/outreach/SdrCall';
import { isActive } from '@/lib/outreach/workflow';

export default function SdrCallPage() {
  const data = useData();
  return <SdrCall leads={data.leads.filter((l) => isActive(l) && ['sdr', 'followup'].includes(l.stage))} />;
}