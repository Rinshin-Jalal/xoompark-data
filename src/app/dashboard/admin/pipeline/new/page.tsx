import 'server-only';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProspectForm } from '../_components/ProspectForm';

export default function NewProspectPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/dashboard/admin/pipeline"
          className="flex items-center gap-1.5 font-mono text-[10px] text-[#0e1c36]/40 hover:text-[#1a3a7a] mb-4 uppercase tracking-[.12em]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Pipeline
        </Link>
        <h1 className="text-2xl font-bold text-[#0e1c36]">New Prospect</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">Add a prospective provider or operator to the pipeline.</p>
      </div>
      <ProspectForm />
    </div>
  );
}
