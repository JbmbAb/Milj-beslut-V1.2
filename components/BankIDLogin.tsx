import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from '../types';

interface BankIDLoginProps {
  onLogin: (user: User) => void;
}

const BankIDLogin: React.FC<BankIDLoginProps> = ({ onLogin }) => {
  const [step, setStep] = useState<'IDLE' | 'SCAN' | 'SUCCESS'>('IDLE');
  const [personalNumber, setPersonalNumber] = useState('');

  const handleStart = () => {
    if (personalNumber.length === 12) {
      setStep('SCAN');
    }
  };

  useEffect(() => {
    if (step === 'SCAN') {
      const timer = setTimeout(() => {
        setStep('SUCCESS');
        setTimeout(() => {
          onLogin({
            id: 'u1',
            name: 'Erik Andersson',
            personalNumber,
            isAuthenticated: true
          });
        }, 1500);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step, personalNumber, onLogin]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] bg-indigo-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-[40%] -right-[20%] w-[80%] h-[80%] bg-emerald-500/10 rounded-full blur-[120px]"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[3rem] p-12 shadow-2xl relative z-10"
      >
        <div className="flex justify-center mb-10">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-shield-halved text-white text-3xl"></i>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 'IDLE' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center">
                <h1 className="text-3xl font-black text-white tracking-tighter italic mb-2">Välkommen.</h1>
                <p className="text-slate-400 text-sm font-medium">Logga in säkert med BankID för att få tillgång till Miljöintelligens.se</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4">Personnummer (ÅÅÅÅMMDDXXXX)</label>
                  <input 
                    type="text"
                    value={personalNumber}
                    onChange={(e) => setPersonalNumber(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    placeholder="198501011234"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold tracking-widest outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  />
                </div>
                <button 
                  onClick={handleStart}
                  disabled={personalNumber.length !== 12}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-black py-5 rounded-2xl text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-indigo-500/20"
                >
                  Öppna BankID
                </button>
              </div>
            </motion.div>
          )}

          {step === 'SCAN' && (
            <motion.div 
              key="scan"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="text-center space-y-10"
            >
              <div className="relative w-48 h-48 mx-auto">
                <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-[2rem] animate-pulse"></div>
                <div className="absolute inset-4 border-2 border-indigo-500 rounded-[1.5rem] flex items-center justify-center">
                  <i className="fas fa-qrcode text-6xl text-indigo-500"></i>
                </div>
                <motion.div 
                  className="absolute top-0 left-0 w-full h-1 bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.8)]"
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight italic mb-2">Väntar på BankID...</h2>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Skanna QR-koden i din BankID-app</p>
              </div>
            </motion.div>
          )}

          {step === 'SUCCESS' && (
            <motion.div 
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <div className="w-24 h-24 bg-emerald-500 rounded-full mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <i className="fas fa-check text-white text-4xl"></i>
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight italic mb-2">Inloggad!</h2>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Välkommen tillbaka Erik</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-12 pt-8 border-t border-white/5 flex justify-center gap-6 opacity-40">
          <i className="fas fa-lock text-white text-sm"></i>
          <i className="fas fa-fingerprint text-white text-sm"></i>
          <i className="fas fa-id-card text-white text-sm"></i>
        </div>
      </motion.div>
    </div>
  );
};

export default BankIDLogin;
