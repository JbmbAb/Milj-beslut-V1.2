import React, { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { callMvp } from '../../services/mvpApiClient';
import type { Project } from './mvpDemoModel';
import { getProjectMunicipality } from './mvpDemoModel';
import { Badge, Card } from './mvpDemoShared';

type PermitFormData = {
  businessName: string;
  municipality: string;
  property: string;
  ewcCode: string;
  wasteDescription: string;
  volume: string;
  hazardous: boolean;
  waterHandling: string;
  storageMethod: string;
};

type PermitDraftResponse = {
  document_type: string;
  draft_text: string;
};

type EditableFieldKey = 'businessName' | 'municipality' | 'property' | 'ewcCode' | 'volume';

const editableFields: Array<{ label: string; key: EditableFieldKey }> = [
  { label: 'Verksamhetsutövare', key: 'businessName' },
  { label: 'Kommun', key: 'municipality' },
  { label: 'Fastighet', key: 'property' },
  { label: 'EWC-kod', key: 'ewcCode' },
  { label: 'Volym (ton)', key: 'volume' },
];

type MvpPermitGeneratorViewProps = {
  project: Project;
};

const MvpPermitGeneratorView: React.FC<MvpPermitGeneratorViewProps> = ({ project }) => {
  const [formData, setFormData] = useState<PermitFormData>({
    businessName: 'Återvinningsbolaget AB',
    municipality: getProjectMunicipality(project.propertyDesignation),
    property: project.propertyDesignation,
    ewcCode: '17 05 04',
    wasteDescription: 'Osorterat schaktavfall från infrastrukturprojekt.',
    volume: '1500',
    hazardous: false,
    waterHandling: 'Dagvatten leds till oljeavskiljare och därefter till recipient.',
    storageMethod: 'Massor lagras i tätade fack på hårdgjord yta under tak.',
  });
  const [result, setResult] = useState<PermitDraftResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const municipality = getProjectMunicipality(project.propertyDesignation);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData((current) => ({
      ...current,
      property: project.propertyDesignation,
      municipality: project.coverage.municipality > 0 ? municipality : current.municipality,
    }));
  }, [project]);

  const generate = async () => {
    setLoading(true);
    try {
      const response = await callMvp<PermitDraftResponse>('/api/v1/permit/generate', {
        method: 'POST',
        body: {
          project_data: {
            name: formData.businessName,
            municipality: formData.municipality,
            property_id: formData.property,
            ewc_code: formData.ewcCode,
            volume_tons: Number(formData.volume),
          },
          process_description: formData.wasteDescription,
          water_management: formData.waterHandling,
          storage_safety: formData.storageMethod,
        },
      });
      setResult(response);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const downloadDocx = async () => {
    if (!result?.draft_text) return;

    try {
      const blob = await callMvp<Blob>('/api/v1/document/export', {
        method: 'POST',
        body: {
          document_type: result.document_type,
          draft_text: result.draft_text,
        },
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Anmälan_C_${formData.property.replace(/ /g, '_')}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="animate-in grid gap-8 slide-in-from-bottom-6 duration-500 lg:grid-cols-[1fr_1.5fr]">
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-black text-slate-900">Underlag C-anmälan</h2>
          <div className="space-y-4">
            {editableFields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-xs font-black uppercase text-slate-400">
                  {field.label}
                </label>
                <input
                  type="text"
                  value={formData[field.key]}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs font-black uppercase text-slate-400">
                Hantering av vatten
              </label>
              <textarea
                rows={3}
                value={formData.waterHandling}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    waterHandling: event.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          <button
            onClick={() => {
              void generate();
            }}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-slate-900 py-4 font-black text-white shadow-xl transition hover:bg-black disabled:opacity-50"
          >
            {loading ? 'Genererar utkast...' : 'Generera C-anmälan'}
          </button>
        </Card>
      </div>

      <div className="space-y-6">
        {result ? (
          <div className="animate-in space-y-6 fade-in duration-700">
            <header className="flex items-center justify-between">
              <Badge label="Genererat Utkast" color="bg-indigo-600 px-3 py-1.5 text-white" />
              <button
                onClick={() => {
                  void downloadDocx();
                }}
                className="flex items-center gap-2 text-sm font-black text-indigo-600 transition hover:text-indigo-800"
              >
                <Download size={18} /> Ladda ned .docx
              </button>
            </header>

            <div className="prose prose-slate max-w-none whitespace-pre-wrap rounded-3xl border border-slate-200 bg-white p-10 font-['Plus_Jakarta_Sans'] text-sm leading-relaxed shadow-xl">
              {result.draft_text}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[500px] h-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
            <div className="mb-6 flex h-20 w-20 rotate-12 items-center justify-center rounded-full bg-white shadow-lg">
              <FileText className="text-slate-300" size={40} />
            </div>
            <h3 className="text-lg font-bold text-slate-500">Ingen genererad data än</h3>
            <p className="mt-2 max-w-xs text-sm text-slate-400">
              Fyll i formuläret och tryck på kör för att skapa ett AI-understött anmälningsdokument.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MvpPermitGeneratorView;
