import React, { useState } from 'react';
import { AlertTriangle, ClipboardCheck, Rocket } from 'lucide-react';
import { callCore } from '../../services/coreApiClient';
import type { Classification, Project } from './coreDemoModel';
import { Badge, Card } from './coreDemoShared';

type CoreClassificationPanelViewProps = {
  project: Project;
};

const CoreClassificationPanelView: React.FC<CoreClassificationPanelViewProps> = ({ project }) => {
  const [data, setData] = useState<Classification | null>(null);
  const [loading, setLoading] = useState(false);

  const runClassification = async () => {
    setLoading(true);
    try {
      const response = await callCore<Classification>('/api/v1/classification', {
        method: 'POST',
        body: { projectId: project.id },
      });
      setData(response);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in slide-in-from-right-4 space-y-6 duration-400">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">AI-Klassificering</h2>
          <p className="text-sm text-slate-500">
            Bestäm verksamhetstyp och risknivå baserat på befintliga beslut.
          </p>
        </div>
        {!data ? (
          <button
            onClick={() => {
              void runClassification();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl bg-teal-600 px-6 py-3 font-black text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 disabled:opacity-50"
          >
            <Rocket size={18} /> {loading ? 'Analyserar...' : 'Kör Klassificering'}
          </button>
        ) : null}
      </div>

      {data ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Resultat</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Föreslagen Klass:</span>
                <span className="text-2xl font-black text-teal-600">{data.classification}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Verksamhetskod:</span>
                <Badge label={data.suggestedCode} color="bg-teal-50 py-1.5 text-sm text-teal-700" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Risknivå:</span>
                <Badge
                  label={data.riskLevel}
                  color={
                    data.riskLevel === 'HIGH' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  }
                  className="px-3"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Confidence:</span>
                <span className="font-bold text-slate-900">{Math.round(data.confidence * 100)}%</span>
              </div>
            </div>

            {data.missingFields.length > 0 ? (
              <div className="mt-8 rounded-2xl border border-amber-100 bg-amber-50 p-4">
                <p className="mb-2 flex items-center gap-1 text-xs font-black uppercase text-amber-700">
                  <AlertTriangle size={14} /> Saknade fält
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.missingFields.map((field) => (
                    <Badge
                      key={field}
                      label={field}
                      color="border border-amber-200 bg-white text-amber-700"
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="border-none bg-slate-900 p-6 text-white shadow-xl">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
              <ClipboardCheck size={16} /> Juridisk Evidens (RAG)
            </h3>
            <div className="space-y-4">
              {data.citations.map((citation, index) => (
                <div
                  key={`${citation.source}-${index}`}
                  className="space-y-2 border-b border-slate-800 pb-4 last:border-0"
                >
                  <p className="text-[10px] font-bold uppercase tracking-tighter text-teal-400">
                    {citation.source}
                  </p>
                  <p className="text-[13px] italic leading-relaxed text-slate-300">
                    "...{citation.snippet}..."
                  </p>
                  {citation.municipality ? (
                    <Badge label={citation.municipality} color="bg-slate-800 text-slate-400" />
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default CoreClassificationPanelView;
