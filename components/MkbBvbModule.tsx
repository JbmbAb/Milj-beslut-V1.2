import React, { useState } from 'react';

type AssessmentCriterion = {
  id: string;
  label: string;
  status: 'pending' | 'yes' | 'no';
  description: string;
};

const BVB_CRITERIA: AssessmentCriterion[] = [
  {
    id: 'protected_area',
    label: 'Inom eller nära skyddat område',
    status: 'pending',
    description: 'Ligger verksamheten inom ett Natura 2000-område eller naturreservat?',
  },
  {
    id: 'water_impact',
    label: 'Betydande påverkan på vatten',
    status: 'pending',
    description: 'Finns risk för påverkan på yt- eller grundvattenstatus?',
  },
  {
    id: 'waste_volume',
    label: 'Stora mängder avfall (>10 000 ton)',
    status: 'pending',
    description: 'Hanteras volymer som överstiger gränsvärden för anmälningsplikt?',
  },
  {
    id: 'cultural_heritage',
    label: 'Påverkan på kulturmiljö',
    status: 'pending',
    description: 'Finns fornlämningar eller riksintressen för kulturmiljövård i närheten?',
  },
];

const MkbBvbModule: React.FC = () => {
  const [criteria, setCriteria] = useState(BVB_CRITERIA);
  const [generatingMkb, setGeneratingMkb] = useState(false);
  const [mkbDraft, setMkbDraft] = useState<string | null>(null);

  const updateStatus = (id: string, status: 'yes' | 'no') => {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  };

  const generateMkb = async () => {
    setGeneratingMkb(true);
    // Simulerar AI-generering av MKB baserat på kriterier
    setTimeout(() => {
      const hasSignificantImpact = criteria.some((c) => c.status === 'yes');
      setMkbDraft(`
# Utkast: Miljökonsekvensbeskrivning (MKB)
**Datum:** ${new Date().toLocaleDateString()}
**Status:** ${hasSignificantImpact ? 'Betydande miljöpåverkan antas' : 'Ej betydande miljöpåverkan'}

## 1. Verksamhetsbeskrivning
Baserat på valda parametrar omfattar verksamheten masshantering och logistik. 

## 2. Behovsbedömning (BVB)
${criteria.map((c) => `- ${c.label}: ${c.status === 'yes' ? 'JA' : 'NEJ'}`).join('\n')}

## 3. Slutsats
${
  hasSignificantImpact
    ? 'Då betydande miljöpåverkan inte kan uteslutas krävs en fullständig MKB enligt Miljöbalken 6 kap.'
    : 'Verksamheten bedöms inte medföra betydande miljöpåverkan.'
}
      `);
      setGeneratingMkb(false);
    }, 2000);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h3 className="text-2xl font-black text-slate-900">Behovsbedömning & MKB</h3>
        <p className="text-slate-500 mt-1">Identifiera om verksamheten innebär betydande miljöpåverkan.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
          <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">
            Kriterier för behovsbedömning
          </h4>
          <div className="space-y-6">
            {criteria.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800">{c.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{c.description}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateStatus(c.id, 'no')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${c.status === 'no' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                  >
                    Nej
                  </button>
                  <button
                    onClick={() => updateStatus(c.id, 'yes')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${c.status === 'yes' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                  >
                    Ja
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={generateMkb}
            disabled={criteria.some((c) => c.status === 'pending') || generatingMkb}
            className="w-full mt-10 py-4 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-800 transition-all"
          >
            {generatingMkb ? 'Genererar utkast...' : 'Generera MKB-utkast'}
          </button>
        </div>

        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-[2rem] p-8">
          <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Dokumentutkast</h4>
          {mkbDraft ? (
            <div className="prose prose-slate prose-sm max-w-none">
              <div className="whitespace-pre-wrap font-serif text-slate-700 leading-relaxed">{mkbDraft}</div>
              <button className="mt-6 flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                <i className="fas fa-file-pdf" /> Ladda ner som PDF
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-40 py-20 text-center">
              <i className="fas fa-file-signature text-4xl mb-4" />
              <p className="text-xs font-bold uppercase tracking-widest">
                Fyll i behovsbedömningen för att generera MKB
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MkbBvbModule;
