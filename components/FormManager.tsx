
import React, { useState } from 'react';
import { EnvironmentalForm } from '../types';
import { autoFillFormSection } from '../services/geminiService';

const MOCK_FORM: EnvironmentalForm = {
  id: 'mkb-90.131',
  title: 'Anmälan om miljöfarlig verksamhet (90.131)',
  wasteCode: '90.131',
  sections: [
    {
      title: 'Verksamhetsutövare',
      fields: [
        { id: 'company', label: 'Företagsnamn', type: 'text', required: true, value: '' },
        { id: 'org_nr', label: 'Organisationsnummer', type: 'text', required: true, value: '' }
      ]
    },
    {
      title: 'Platsbeskrivning',
      fields: [
        { id: 'property', label: 'Fastighetsbeteckning', type: 'text', required: true, value: '' },
        { id: 'area_desc', label: 'Beskrivning av omgivning', type: 'textarea', required: true, value: '' }
      ]
    },
    {
      title: 'Teknisk Beskrivning',
      fields: [
        { id: 'mass_vol', label: 'Total mängd massor (ton)', type: 'number', required: true, value: '' },
        { id: 'handling', label: 'Hanteringsmetod', type: 'select', options: ['Sortering', 'Krossning', 'Mellanlagring'], required: true, value: '' }
      ]
    }
  ]
};

const FormManager: React.FC = () => {
  const [form, setForm] = useState<EnvironmentalForm>(MOCK_FORM);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSigned, setIsSigned] = useState(false);

  const handleFieldChange = (sectionIdx: number, fieldIdx: number, value: string) => {
    const newForm = { ...form };
    newForm.sections[sectionIdx].fields[fieldIdx].value = value;
    setForm(newForm);
  };

  const handleAIAutoFill = async (sectionIdx: number) => {
    const section = form.sections[sectionIdx];
    setIsGenerating(section.title);
    
    try {
      // AI ger nu ett UTKAST som användaren kan redigera, det är inte tvingande
      const result = await autoFillFormSection(section.title, { property: "Fastighet X:Y", wasteCode: "90.131" });
      const newForm = { ...form };
      const targetField = section.fields.find(f => f.type === 'textarea') || section.fields[0];
      targetField.value = result;
      setForm(newForm);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(null);
    }
  };

  const handleSubmit = () => {
    setIsSuccess(true);
    setTimeout(() => setIsSuccess(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500 pb-20">
      <header className="flex justify-between items-end bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter italic">Blankett-hantering.</h2>
          <p className="text-slate-500 mt-1 font-medium italic">Fyll i siffror och text för ditt miljöunderlag. AI-stöd finns som förslag.</p>
        </div>
        <div className="flex gap-2">
           <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-100">Manuellt läge aktivt</span>
        </div>
      </header>

      <div className="space-y-6 relative">
        {!isSigned && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center overflow-hidden">
            <div className="text-[12rem] font-black text-slate-900/5 -rotate-45 uppercase tracking-[0.2em] whitespace-nowrap select-none">
              UTKAST - EJ VERIFIERAT
            </div>
          </div>
        )}
        {form.sections.map((section, sIdx) => (
          <div key={section.title} className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-8 relative overflow-hidden">
            <div className="flex justify-between items-center border-b border-slate-50 pb-6">
               <h3 className="text-xl font-black text-slate-800 tracking-tight">{section.title}</h3>
               <button 
                onClick={() => handleAIAutoFill(sIdx)}
                disabled={!!isGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
               >
                 {isGenerating === section.title ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles"></i>}
                 Få AI-förslag
               </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {section.fields.map((field, fIdx) => (
                <div key={field.id} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 block mb-2">{field.label} {field.required && '*'}</label>
                  
                  {field.type === 'text' || field.type === 'number' ? (
                    <input 
                      type={field.type} 
                      value={field.value}
                      placeholder="Mata in värde..."
                      onChange={(e) => handleFieldChange(sIdx, fIdx, e.target.value)}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea 
                      rows={5}
                      value={field.value}
                      placeholder="Skriv din text här..."
                      onChange={(e) => handleFieldChange(sIdx, fIdx, e.target.value)}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all leading-relaxed italic"
                    />
                  ) : field.type === 'select' ? (
                    <select 
                      value={field.value}
                      onChange={(e) => handleFieldChange(sIdx, fIdx, e.target.value)}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                    >
                      <option value="">Välj...</option>
                      {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900 p-10 rounded-[3rem] text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl">
         <div>
            <h4 className="text-2xl font-black italic tracking-tighter">Färdig med anmälan?</h4>
            <p className="text-slate-400 text-sm mt-1">Siffrorna och texten du angett inkluderas i den slutliga PDF-handlingen.</p>
         </div>
          <button 
            onClick={() => {
              if (!isSigned) {
                setIsSigned(true);
              } else {
                handleSubmit();
              }
            }}
            className={`px-12 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95 flex items-center gap-3 ${
              isSuccess ? 'bg-emerald-500 text-white' : isSigned ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {isSuccess ? <i className="fas fa-check"></i> : isSigned ? <i className="fas fa-file-export"></i> : <i className="fas fa-signature"></i>}
            {isSuccess ? 'Skickad!' : isSigned ? 'Skapa & Signera Handling' : 'Verifiera & Signera Utkast'}
          </button>
      </div>
    </div>
  );
};

export default FormManager;
