'use client';

import { useData } from '@/components/outreach/DataContext';
import { BdrEmail } from '@/components/outreach/BdrEmail';
import { isActive } from '@/lib/outreach/workflow';

export default function BdrEmailPage() {
  const data = useData();
  return <BdrEmail leads={data.leads.filter((l) => isActive(l) && ['ready', 'email_followup', 'email_reply'].includes(l.stage))} />;
}