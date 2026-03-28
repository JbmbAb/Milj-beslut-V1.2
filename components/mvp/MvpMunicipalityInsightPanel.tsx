import React, { useEffect, useState } from 'react';
import { Activity, ClipboardCheck, Scale, ShieldAlert } from 'lucide-react';
import { callMvp } from '../../services/mvpApiClient';
import type { MunicipalityInsight, Project } from './mvpDemoModel';
import { getProjectMunicipality } from './mvpDemoModel';
import { Badge, Card } from './mvpDemoShared';

type MunicipalityInsightCardProps = {
  name: string;
};

const MunicipalityInsightCard: React.FC<MunicipalityInsightCardProps> = ({ name }) => {
  const [insight, setInsight] = useState<MunicipalityInsight | null>(null);

  useEffect(() => {
    if (!name) return;

    let cancelled = false;

    void callMvp<{ insight: MunicipalityInsight }>(`/api/v1/municipality/${name}/insight`, {
      method: 'GET',
    })
      .then((response) => {
        if (!cancelled) {
          setInsight(response.insight);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!insight) {
    return <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  }

  return (
    <Card className="border-indigo-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-black leading-none text-slate-900">Tillsynsindex: {insight.name}</h3>
          <p className="mt-1 text-[10px] font-black uppercase text-slate-400">Regulatorisk profil</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-indigo-600">{insight.index}</div>
          <div className="text-[9px] font-bold uppercase text-slate-400">
            Ranking: #{insight.ranking} av 290
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-slate-50 p-2.5 text-center">
          <Scale size={14} className="mx-auto mb-1.5 text-indigo-500" />
          <div className="text-xs font-black">{insight.stats.avgRequirements}</div>
          <div className="text-[8px] font-bold uppercase text-slate-400">Krav / beslut</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5 text-center">
          <ShieldAlert size={14} className="mx-auto mb-1.5 text-emerald-500" />
          <div className="text-xs font-black">{insight.stats.riskCoveragePct}%</div>
          <div className="text-[8px] font-bold uppercase text-slate-400">Riskfokus</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5 text-center">
          <ClipboardCheck size={14} className="mx-auto mb-1.5 text-amber-500" />
          <div className="text-xs font-black">{insight.stats.documentationLevel}</div>
          <div className="text-[8px] font-bold uppercase text-slate-400">Dok-krav</div>
        </div>
      </div>

      <div className="space-y-4">
        {insight.patterns?.length ? (
          <div>
            <h4 className="mb-2 text-[9px] font-black uppercase text-slate-400">Regulatoriska Mönster</h4>
            <div className="flex flex-wrap gap-1.5">
              {insight.patterns.map((pattern) => (
                <Badge
                  key={pattern}
                  label={pattern}
                  color="border border-amber-100 bg-amber-50 text-amber-700"
                />
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <h4 className="mb-2 text-[9px] font-black uppercase text-slate-400">Vanligaste Fokusområden</h4>
          <div className="flex flex-wrap gap-1.5">
            {insight.commonRisks.map((risk) => (
              <Badge key={risk} label={risk} color="bg-indigo-50 text-indigo-700" />
            ))}
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-[9px] font-black uppercase text-slate-400">
            Typiska Krav i {insight.name}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {insight.commonRequirements.map((requirement) => (
              <Badge key={requirement} label={requirement} color="bg-emerald-50 text-emerald-700" />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

type MvpMunicipalityInsightPanelProps = {
  project: Project;
};

const MvpMunicipalityInsightPanel: React.FC<MvpMunicipalityInsightPanelProps> = ({ project }) => {
  const municipality = getProjectMunicipality(project.propertyDesignation);

  return (
    <aside className="animate-in space-y-6 slide-in-from-right-4 duration-500">
      <div className="text-xs font-black uppercase tracking-widest text-slate-400">
        Regulatorisk Insikt
      </div>
      <MunicipalityInsightCard key={municipality} name={municipality} />

      <Card className="border-none bg-slate-900 p-5 text-white">
        <div className="mb-4 flex items-center gap-3">
          <Activity size={18} className="text-indigo-400" />
          <h4 className="text-sm font-black">Status i {municipality}</h4>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          Kommunen har nyligen skärpt tillsynen kring schaktmassor nära vattenskyddsområden.
        </p>
        <Badge label="Nytt villkor" color="w-fit bg-rose-500/20 text-rose-300" />
      </Card>
    </aside>
  );
};

export default MvpMunicipalityInsightPanel;
