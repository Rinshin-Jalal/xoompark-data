import { getProspects } from '@/lib/outreach/actions';
import { PipelineKanban } from '@/components/pipeline/PipelineKanban';
import type { BDProspect } from '@/lib/pipeline/types';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  // Prospect-driven: cards render from bdProspects alone. Lots are only read
  // inside the detail sheet's drill-down.
  let prospects: BDProspect[] = [];
  try {
    prospects = await getProspects();
  } catch {
    prospects = [];
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> BD PIPELINE
          </div>
          <h1>Deals in motion.</h1>
          <p>Every promoted prospect, from qualification to live inventory.</p>
        </div>
      </div>
      <PipelineKanban prospects={prospects} />
    </>
  );
}
