import React from 'react';
import { useBankIdAuth, type BankIdLoginResult } from '../../src/ui/hooks/useAuth';

export interface AuthInterfaceProps {
  onComplete: (result: BankIdLoginResult) => void;
}

export const AuthInterface: React.FC<AuthInterfaceProps> = ({ onComplete }) => {
  const { initiate, cancel, status, order, error, isInitializing } = useBankIdAuth(onComplete);

  return (
    <div
      data-testid="bankid-auth-interface"
      className="flex flex-col items-center justify-center p-8 space-y-6 bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl max-w-sm mx-auto animate-in zoom-in duration-300"
    >
      <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white text-3xl shadow-xl shadow-blue-100">
        <i className="fas fa-shield-halved"></i>
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase italic">
          BankID Verifiering
        </h2>
        <p className="text-slate-500 text-sm font-medium">
          Säker inloggning för miljöhandläggare och projektledare.
        </p>
      </div>

      {status === 'idle' && (
        <button
          data-testid="bankid-start"
          onClick={() => initiate()}
          disabled={isInitializing}
          className="w-full py-5 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg flex items-center justify-center gap-3"
        >
          {isInitializing ? (
            <i className="fas fa-spinner fa-spin"></i>
          ) : (
            <i className="fas fa-fingerprint"></i>
          )}
          Starta BankID
        </button>
      )}

      {status === 'pending' && order && (
        <div className="w-full space-y-6 text-center animate-in fade-in" data-testid="bankid-pending">
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex justify-center">
            {/* Real QR would be rendered here, using qrPayload from order */}
            <div className="w-48 h-48 bg-white border-4 border-slate-900 rounded-2xl flex items-center justify-center relative overflow-hidden">
              <i className="fas fa-qrcode text-6xl text-slate-200"></i>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest animate-pulse">
              Väntar på signering...
            </p>
            <button
              data-testid="bankid-cancel"
              onClick={() => cancel()}
              className="text-[10px] font-black uppercase text-slate-400 hover:text-rose-500 transition-colors"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="w-full space-y-4 animate-in shake duration-500" data-testid="bankid-failed">
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold text-center">
            {error || 'Verifiering misslyckades'}
          </div>
          <button
            data-testid="bankid-retry"
            onClick={() => initiate()}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all"
          >
            Försök igen
          </button>
        </div>
      )}

      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
        Powered by Miljobeslut.se Hexagonal Core V2
      </p>
    </div>
  );
};
