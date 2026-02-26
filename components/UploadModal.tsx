
import React, { useState } from 'react';
import { processDocumentOCR } from '../services/geminiService';
import { Permit } from '../types';

interface UploadModalProps {
  onComplete: (permit: Partial<Permit>) => void;
  onClose: () => void;
}

type UploadStatus = 'idle' | 'loading' | 'success' | 'error';

const UploadModal: React.FC<UploadModalProps> = ({ onComplete, onClose }) => {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('loading');
    setStatusMessage('Läser in filen...');

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        setStatusMessage('Analyserar dokument med Gemini 3 AI...');
        const result = await processDocumentOCR(base64, file.type);
        
        setStatusMessage('Data extraherad! Sparar till databasen...');
        setStatus('success');
        
        // Wait a brief moment to show success state before closing/completing
        setTimeout(() => {
          onComplete({ ...result, filename: file.name });
        }, 1200);
      } catch (err: any) {
        setStatus('error');
        setStatusMessage('Ett fel uppstod vid analysen.');
        setErrorDetail(err.message || 'Okänt fel vid OCR-behandling.');
        console.error(err);
      }
    };
    
    reader.onerror = () => {
      setStatus('error');
      setStatusMessage('Kunde inte läsa filen.');
      setErrorDetail('Läsfel i webbläsaren.');
    };

    reader.readAsDataURL(file);
  };

  const reset = () => {
    setStatus('idle');
    setStatusMessage('');
    setErrorDetail(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 transition-all duration-300">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-10 animate-in fade-in zoom-in duration-300 border border-slate-200">
        
        <div className="text-center">
          {/* Status Icons */}
          <div className="relative mx-auto mb-6 w-20 h-20">
            {status === 'idle' && (
              <div className="w-full h-full bg-blue-50 text-blue-600 rounded-full flex items-center justify-center animate-in zoom-in">
                <i className="fas fa-cloud-upload-alt text-3xl"></i>
              </div>
            )}
            {status === 'loading' && (
              <div className="w-full h-full bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <i className="fas fa-microchip text-2xl animate-pulse"></i>
              </div>
            )}
            {status === 'success' && (
              <div className="w-full h-full bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center animate-in zoom-in">
                <i className="fas fa-check-circle text-3xl"></i>
              </div>
            )}
            {status === 'error' && (
              <div className="w-full h-full bg-rose-50 text-rose-600 rounded-full flex items-center justify-center animate-in shake duration-500">
                <i className="fas fa-exclamation-triangle text-3xl"></i>
              </div>
            )}
          </div>

          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {status === 'idle' && 'Importera Miljötillstånd'}
            {status === 'loading' && 'AI-Bearbetning Pågår'}
            {status === 'success' && 'Analys Färdig!'}
            {status === 'error' && 'Import Misslyckades'}
          </h2>
          
          <p className="text-slate-500 text-sm mt-3 font-medium leading-relaxed">
            {status === 'idle' && 'Ladda upp PDF eller bild. Vår AI sköter OCR, kategorisering och riskbedömning automatiskt.'}
            {status !== 'idle' && statusMessage}
          </p>
        </div>

        <div className="mt-8">
          {status === 'idle' && (
            <label className="group flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-200 rounded-[2rem] cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all duration-300 bg-slate-50/50">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100 mb-4 group-hover:scale-110 transition-transform">
                  <i className="fas fa-plus text-slate-400 group-hover:text-blue-500"></i>
                </div>
                <p className="mb-1 text-sm text-slate-700 font-black tracking-tight uppercase">Välj fil från datorn</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">PDF, PNG, JPG • Max 10MB</p>
              </div>
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.png,.jpg,.jpeg" />
            </label>
          )}

          {status === 'loading' && (
            <div className="space-y-4">
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full w-2/3 animate-progress-indeterminate"></div>
              </div>
              <p className="text-[10px] text-slate-400 font-black uppercase text-center tracking-[0.2em] animate-pulse">
                Synkroniserar med Gemini Engine
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-left">
              <p className="text-rose-800 text-xs font-bold mb-1 uppercase tracking-tight">Feldetaljer:</p>
              <p className="text-rose-600 text-[11px] font-medium leading-relaxed italic">{errorDetail}</p>
            </div>
          )}
        </div>

        <div className="mt-10 flex flex-col gap-3">
          {status === 'error' ? (
            <button 
              onClick={reset}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all active:scale-95"
            >
              Försök Igen
            </button>
          ) : (
            <button 
              onClick={onClose} 
              disabled={status === 'loading' || status === 'success'}
              className="w-full py-4 text-xs font-black text-slate-400 hover:text-slate-800 transition-colors uppercase tracking-widest disabled:opacity-20"
            >
              {status === 'success' ? 'Slutför...' : 'Avbryt Import'}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); width: 30%; }
          50% { transform: translateX(0%); width: 60%; }
          100% { transform: translateX(100%); width: 30%; }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 2s infinite linear;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default UploadModal;
