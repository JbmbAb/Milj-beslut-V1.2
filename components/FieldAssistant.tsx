
import React, { useState } from 'react';
import { analyzeSiteImage, analyzeTechnicalDrawing, analyzeDrawingOCR } from '../services/geminiService';

const FieldAssistant: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'site' | 'drawing'>('site');
  const [currentFileType, setCurrentFileType] = useState<string>('');
  const [currentBase64, setCurrentBase64] = useState<string>('');

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Full = reader.result as string;
      const base64 = base64Full.split(',')[1];
      setImage(base64Full);
      setCurrentBase64(base64);
      setCurrentFileType(file.type);
      setAnalysis(null);
      
      // Starta standardanalys direkt vid uppladdning
      runAnalysis('standard');
    };
    reader.readAsDataURL(file);
  };

  const runAnalysis = async (type: 'standard' | 'ocr') => {
    if (!currentBase64) return;
    
    setIsLoading(true);
    setAnalysis(null);

    try {
      let result;
      if (mode === 'drawing') {
        if (type === 'ocr') {
          result = await analyzeDrawingOCR(currentBase64, currentFileType);
        } else {
          result = await analyzeTechnicalDrawing(currentBase64, currentFileType);
        }
      } else {
        result = await analyzeSiteImage(currentBase64, currentFileType);
      }
      setAnalysis(result);
    } catch {
      setAnalysis("Misslyckades med att analysera dokumentet. Kontrollera anslutningen eller filformatet.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">AI Analys & Granskning</h2>
        <p className="text-slate-500 mt-1">Specialiserad granskning av fältfoton och tekniska underlag.</p>
      </header>

      {/* Mode Switcher */}
      <div className="flex p-1 bg-slate-200 rounded-2xl w-fit mb-6">
        <button 
          onClick={() => { setMode('site'); setAnalysis(null); setImage(null); }}
          className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'site' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <i className="fas fa-camera mr-2"></i> Fältfoto
        </button>
        <button 
          onClick={() => { setMode('drawing'); setAnalysis(null); setImage(null); }}
          className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${mode === 'drawing' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <i className="fas fa-drafting-pencil mr-2"></i> Ritning / Situationskarta
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className={`relative aspect-square rounded-3xl border-4 border-dashed transition-all flex flex-col items-center justify-center p-8 text-center ${
            image ? 'border-blue-500 bg-white shadow-xl' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
          }`}>
            {image ? (
              <>
                <img src={image} className="absolute inset-0 w-full h-full object-contain p-4 rounded-[1.25rem]" alt="Preview" />
                <div className="absolute inset-0 bg-white/80 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center rounded-[1.25rem]">
                   <label className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer">
                      Byt dokument
                      <input type="file" className="hidden" onChange={handleCapture} accept="image/*,application/pdf" />
                   </label>
                </div>
              </>
            ) : (
              <>
                <i className={`fas ${mode === 'drawing' ? 'fa-map' : 'fa-camera'} text-4xl text-slate-300 mb-4`}></i>
                <p className="text-slate-600 font-bold mb-2">
                  {mode === 'drawing' ? 'Ladda upp situationskarta' : 'Ta en bild från fältet'}
                </p>
                <label className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-600/20 cursor-pointer transition-all active:scale-95">
                  <i className="fas fa-upload mr-2"></i> Välj Fil
                  <input type="file" className="hidden" onChange={handleCapture} accept="image/*,application/pdf" />
                </label>
              </>
            )}
          </div>

          <div className={`p-6 rounded-3xl border ${mode === 'drawing' ? 'bg-blue-50 border-blue-100' : 'bg-amber-50 border-amber-100'}`}>
            <h4 className={`text-sm font-black uppercase tracking-widest mb-3 ${mode === 'drawing' ? 'text-blue-800' : 'text-amber-800'}`}>
              <i className={`fas ${mode === 'drawing' ? 'fa-lightbulb' : 'fa-shield-halved'} mr-2`}></i>
              {mode === 'drawing' ? 'OCR & Ritningsstöd' : 'Säkerhetstips'}
            </h4>
            <p className="text-xs font-medium text-slate-600 leading-relaxed">
              {mode === 'drawing' 
                ? 'Använd "Extrahera Text & Mått" för att få ut exakta siffervärden och symbolförklaringar från ritningen.' 
                : 'Fältassistenten identifierar läckage, felaktig förvaring och saknad märkning på plats.'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 min-h-[400px] flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${mode === 'drawing' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
                <i className={`fas ${mode === 'drawing' ? 'fa-brain' : 'fa-microchip'}`}></i>
              </div>
              <h3 className="font-black text-slate-800 uppercase tracking-tight">
                 AI Analys
              </h3>
            </div>
            
            {mode === 'drawing' && image && !isLoading && (
              <div className="flex gap-2">
                <button 
                  onClick={() => runAnalysis('standard')}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[10px] font-black rounded-lg hover:bg-slate-200"
                  title="Visuell tolkning"
                >
                  Tolkning
                </button>
                <button 
                  onClick={() => runAnalysis('ocr')}
                  className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-black rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-600/20"
                  title="Extrahera mått & text"
                >
                  OCR
                </button>
              </div>
            )}
          </div>

          <div className="flex-1">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm font-bold text-slate-500 italic">
                  Bearbetar dokumentet...
                </p>
              </div>
            ) : analysis ? (
              <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed space-y-4 animate-in fade-in slide-in-from-right-4">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 whitespace-pre-wrap text-xs font-medium font-sans italic">
                  {analysis}
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 py-3 bg-blue-50 text-blue-700 font-bold rounded-xl text-xs hover:bg-blue-100 transition-colors">
                    <i className="fas fa-file-pdf mr-2"></i> Spara granskning
                  </button>
                  <button className="flex-1 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-100 transition-colors">
                    <i className="fas fa-copy mr-2"></i> Kopiera
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                <i className={`fas ${mode === 'drawing' ? 'fa-map-marked-alt' : 'fa-images'} text-6xl text-slate-200 mb-4`}></i>
                <p className="text-slate-400 font-medium italic">Ladda upp en fil för att starta AI-granskningen</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FieldAssistant;
