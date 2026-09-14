'use client';

import { useData } from '@/components/outreach/DataContext';
import { useDetail } from '@/components/outreach/DetailContext';
import { PipelinePortfolio } from '@/components/outreach/PipelinePortfolio';
import { isActive } from '@/lib/outreach/workflow';

export default function PipelinePage() {
  const data = useData();
  const { open } = useDetail();
  return <PipelinePortfolio leads={data.leads.filter(isActive)} onSelect={open} />;
}