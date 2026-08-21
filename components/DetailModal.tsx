import React, { useState } from 'react';
import { Permit } from '../types';
import { analyzePermitRisk } from '../services/geminiService';
import MunicipalityAvatar from './MunicipalityAvatar';
import { BtfaNoteWidget } from './BtfaNoteWidget';

interface DetailModalProps {
  permit: Permit;
  onClose: () => void;
  /** PRODUCT-RUNTIME-ANSWER-BYPASS-01: navigates to the real, governed Juridiskt Stöd view.
   *  Replaces the removed freeform permit chat (chatWithPermit) -- see that section below for why. */
  onOpenLegalSupport: () => void;
}

const DetailModal: React.FC<DetailModalProps> = ({ permit, onClose, onOpenLegalSupport }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const result = await analyzePermitRisk(permit);
      setAnalysis(result || 'Ingen analys tillgänglig.');
    } catch (error) {
      console.error(error);
      setAnalysis('Fel vid analys.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div
      role="dialog"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200 border border-slate-200">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-6">
            <MunicipalityAvatar name={permit.municipality} size="lg" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-black uppercase rounded shadow-sm">
                  Officiellt Beslut
                </span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {permit.municipality} Kommun
                </span>
              </div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">
                {permit.property_id}
              </h2>
              <p className="text-slate-500 font-bold mt-2 flex items-center gap-2">
                <i className="fas fa-building text-blue-500"></i>{' '}
                {permit.applicant_company || 'Sökande ej identifierad'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 bg-white hover:bg-slate-100 rounded-2xl border border-slate-200 flex items-center justify-center transition-all shadow-sm"
          >
            <i className="fas fa-times text-slate-400 text-xl"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <section className="grid grid-cols-2 gap-4">
                <ContactItem icon="fa-briefcase" label="Konsult" value={permit.consultant_company} />
                <ContactItem icon="fa-user-tie" label="Handläggare" value={permit.contact_person} />
                <div className="col-span-2 bg-blue-600 p-4 rounded-2xl text-white flex items-center justify-between shadow-lg shadow-blue-600/20">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                      <i className="fas fa-envelope"></i>
                    </div>
                    <div>
                      <p className="text-[10px] font-black opacity-60 uppercase tracking-widest">
                        Digital Kontakt
                      </p>
                      <p className="font-bold">{permit.email || 'Ingen e-post registrerad'}</p>
                    </div>
                  </div>
                  {permit.email && (
                    <button className="bg-white text-blue-600 px-4 py-2 rounded-xl text-xs font-black">
                      Skicka E-post
                    </button>
                  )}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Teknisk Sammanfattning
                  </h3>
                  <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded">
                    Checksum: {permit.checksum.substring(0, 12)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 block uppercase font-black mb-1">
                      Avfallskoder
                    </span>
                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <i className="fas fa-barcode text-blue-400"></i> {permit.waste_codes}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 block uppercase font-black mb-1">Datum</span>
                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <i className="fas fa-calendar-alt text-blue-400"></i> {permit.received_date}
                    </span>
                  </div>
                </div>
                <div className="bg-slate-900 text-slate-400 p-6 rounded-3xl font-mono text-[11px] leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap border-t-8 border-slate-800 shadow-inner">
                  <div className="text-slate-500 mb-4 border-b border-slate-800 pb-2 flex justify-between uppercase text-[9px] font-black">
                    <span>Extraherad Fulltext (AI-OCR)</span>
                    <i className="fas fa-lock"></i>
                  </div>
                  {permit.full_text}
                </div>
              </section>

              <section>
                <BtfaNoteWidget caseId={permit.id.toString()} />
              </section>
            </div>

            <div className="flex flex-col gap-6">
              <section className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-[2rem] p-6 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-sm font-black text-indigo-900 uppercase tracking-tight flex items-center">
                    <div className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-indigo-600/20">
                      <i className="fas fa-shield-halved text-xs"></i>
                    </div>
                    AI Riskbedömning
                  </h3>
                  {!analysis && !isAnalyzing && (
                    <button
                      onClick={handleRunAnalysis}
                      className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                    >
                      STARTA ANALYS
                    </button>
                  )}
                </div>
                {isAnalyzing ? (
                  <div className="flex flex-col items-center py-8">
                    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-xs font-bold text-indigo-400 animate-pulse uppercase tracking-widest">
                      Kör juridisk analys...
                    </p>
                  </div>
                ) : analysis ? (
                  <div className="text-sm text-slate-700 leading-relaxed bg-white/50 p-5 rounded-2xl border border-indigo-100 italic">
                    {analysis}
                  </div>
                ) : (
                  <div className="text-center py-8 border-2 border-dashed border-indigo-200 rounded-2xl">
                    <p className="text-xs text-indigo-300 font-bold">
                      Tryck på knappen för att starta en djupgående miljöriskanalys av beslutet.
                    </p>
                  </div>
                )}
              </section>

              {/* PRODUCT-RUNTIME-ANSWER-BYPASS-01: the freeform "Utredningsstöd (AI-Chatt)" section
                  (chatWithPermit -- zero retrieval, zero citations, zero safety gate) was removed
                  per owner decision. No legal-intent classifier was introduced to partially keep
                  it; any legal question belongs in the governed Juridiskt Stöd view instead. */}
              <section className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm text-center">
                <i className="fas fa-scale-balanced text-2xl text-indigo-400 mb-3 block"></i>
                <p className="text-xs text-slate-500 font-medium mb-4">
                  För juridiska frågor om beslutet, använd det styrkta underlaget i Juridiskt Stöd --
                  inte fri chatt.
                </p>
                <button
                  type="button"
                  onClick={onOpenLegalSupport}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                >
                  Ställ juridisk fråga i Juridiskt Stöd
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ContactItem: React.FC<{ icon: string; label: string; value?: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-4 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-blue-200 transition-all">
    <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center">
      <i className={`fas ${icon} text-sm`}></i>
    </div>
    <div>
      <span className="text-[9px] text-slate-400 block uppercase font-black tracking-widest mb-0.5">
        {label}
      </span>
      <span className="text-sm font-bold text-slate-800">{value || 'Ej angivet'}</span>
    </div>
  </div>
);

export default DetailModal;
