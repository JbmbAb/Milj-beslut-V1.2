import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from '../types';
import { callApi, setSession } from '../services/coreApiClient';
import { resolveBankIdLaunchHref } from './applicationWizard/bankIdLaunch';

function readViteAdminOnlyLogin(): boolean {
  return (
    String(
      (import.meta as ImportMeta & { env?: { VITE_LOGIN_ADMIN_ONLY?: string } }).env?.VITE_LOGIN_ADMIN_ONLY ??
        '',
    )
      .trim()
      .toLowerCase() === 'true'
  );
}

interface BankIDLoginProps {
  onLogin: (user: User) => void;
  /**
   * Döljer BankID på inloggningssidan (endast admin). Om `undefined` styrs det av
   * `VITE_LOGIN_ADMIN_ONLY=true` i Vite. Sätt explicit `false` om du ska tvinga BankID
   * trots att env-flaggan är satt.
   */
  adminOnly?: boolean;
}

type BankIdStep = 'IDLE' | 'STARTING' | 'SCAN' | 'SUCCESS' | 'ERROR';

type BankIdInitResponse = {
  ok: boolean;
  orderRef: string;
  orderTime: string;
  qrPayload: string;
  autoStartToken?: string;
  launchMode?: 'bankid' | 'mock';
  launchUrl?: string;
};

type BankIdCollectResponse = {
  ok: boolean;
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string | null;
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    displayName: string;
    bankidId: string;
  };
};

const POLL_INTERVAL_MS = 2000;

type BankIdStatusPayload = {
  ok: boolean;
  mode: 'mock' | 'real' | 'unconfigured';
  canInitiate: boolean;
  message: string;
};

const BankIDLogin: React.FC<BankIDLoginProps> = ({ onLogin, adminOnly: adminOnlyProp }) => {
  const isAdminOnlyLogin =
    adminOnlyProp === true || (adminOnlyProp === undefined && readViteAdminOnlyLogin());
  const [step, setStep] = useState<BankIdStep>('IDLE');
  const [personalNumber, setPersonalNumber] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [qrPayload, setQrPayload] = useState('');
  const [launchMode, setLaunchMode] = useState<'bankid' | 'mock' | null>(null);
  const [hintCode, setHintCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [bankIdStatus, setBankIdStatus] = useState<BankIdStatusPayload | null>(null);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [mockCompleteBusy, setMockCompleteBusy] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const completeLogin = useCallback(
    (payload: NonNullable<BankIdCollectResponse['user']>, accessToken: string, refreshToken?: string) => {
      setSession({
        accessToken,
        refreshToken,
      });
      setStep('SUCCESS');
      stopPolling();
      onLogin({
        id: payload.id,
        name: payload.displayName,
        personalNumber: payload.bankidId,
        isAuthenticated: true,
      });
    },
    [onLogin, stopPolling],
  );

  const collectBankId = useCallback(
    async (currentOrderRef: string) => {
      const result = await callApi<BankIdCollectResponse>('/api/auth/bankid/collect', {
        method: 'POST',
        auth: false,
        body: { orderRef: currentOrderRef },
      });

      if (result.status === 'pending') {
        setHintCode(String(result.hintCode || 'Vantar pa signering i BankID.'));
        return;
      }

      if (result.status === 'failed') {
        stopPolling();
        setStep('ERROR');
        setErrorMessage(String(result.hintCode || 'BankID-avstamning misslyckades.'));
        return;
      }

      if (!result.user || !result.accessToken) {
        throw new Error('BankID svarade utan komplett sessionsdata.');
      }

      completeLogin(result.user, result.accessToken, result.refreshToken);
    },
    [completeLogin, stopPolling],
  );

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    if (isAdminOnlyLogin) {
      return;
    }
    void callApi<BankIdStatusPayload>('/api/auth/bankid/status', { method: 'GET', auth: false })
      .then((payload) => {
        if (payload?.ok) {
          setBankIdStatus(payload);
        }
      })
      .catch(() => {
        // Fail open: låt användaren försöka BankID; fångar faktiska init-fel i handleStart.
        setBankIdStatus({
          ok: true,
          mode: 'real',
          canInitiate: true,
          message: 'Kunde inte läsa BankID-status — du kan fortfarande prova inloggning.',
        });
      });
  }, [isAdminOnlyLogin]);

  useEffect(() => {
    if (isAdminOnlyLogin) {
      return;
    }
    if (typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if ((payload as { type?: string }).type !== 'mock-bankid-complete') return;

      const completedOrderRef = String((payload as { orderRef?: string }).orderRef || '').trim();
      if (!completedOrderRef || completedOrderRef !== orderRef) return;

      void collectBankId(completedOrderRef).catch((error: unknown) => {
        stopPolling();
        setStep('ERROR');
        setErrorMessage(error instanceof Error ? error.message : 'BankID-kontroll misslyckades.');
      });
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [collectBankId, isAdminOnlyLogin, orderRef, stopPolling]);

  const handleStart = async () => {
    if (bankIdStatus && !bankIdStatus.canInitiate) {
      setErrorMessage(
        bankIdStatus.message ||
          'BankID går inte att starta just nu. Använd administratörsinloggning nedan tills avtal och certifikat är klara.',
      );
      return;
    }
    setErrorMessage('');
    setHintCode('');
    setStep('STARTING');

    try {
      const response = await callApi<BankIdInitResponse>('/api/auth/bankid/init', {
        method: 'POST',
        auth: false,
        body: {
          personalNumber: personalNumber || undefined,
        },
      });

      setOrderRef(response.orderRef);
      setQrPayload(response.qrPayload);
      setLaunchMode(response.launchMode || null);
      setStep('SCAN');

      const launchHref = resolveBankIdLaunchHref({
        autoStartToken: response.autoStartToken || null,
        launchMode: response.launchMode || null,
        launchUrl: response.launchUrl || null,
      });

      if (launchHref && typeof window !== 'undefined') {
        const features =
          response.launchMode === 'mock' ? 'popup=yes,width=520,height=640' : 'noopener,noreferrer';
        window.open(launchHref, '_blank', features);
      }

      await collectBankId(response.orderRef);
      if (typeof window !== 'undefined') {
        pollTimerRef.current = window.setInterval(() => {
          void collectBankId(response.orderRef).catch((error: unknown) => {
            stopPolling();
            setStep('ERROR');
            setErrorMessage(error instanceof Error ? error.message : 'BankID-kontroll misslyckades.');
          });
        }, POLL_INTERVAL_MS);
      }
    } catch (error: unknown) {
      stopPolling();
      setStep('ERROR');
      setErrorMessage(error instanceof Error ? error.message : 'Kunde inte starta BankID.');
    }
  };

  const handleCancel = async () => {
    stopPolling();
    const currentOrderRef = orderRef;
    setOrderRef('');
    setQrPayload('');
    setHintCode('');
    setLaunchMode(null);
    setStep('IDLE');

    if (!currentOrderRef) return;

    try {
      await callApi('/api/auth/bankid/cancel', {
        method: 'POST',
        auth: false,
        body: { orderRef: currentOrderRef },
      });
    } catch {
      // Keep UX forgiving; session is already reset client-side.
    }
  };

  const handleMockComplete = async () => {
    if (!orderRef || launchMode !== 'mock') return;

    setMockCompleteBusy(true);
    setErrorMessage('');
    setHintCode('Godkänner mock-BankID...');

    try {
      await callApi('/api/auth/bankid/mock/complete', {
        method: 'POST',
        auth: false,
        body: {
          orderRef,
          bankidId: personalNumber || undefined,
        },
      });
      await collectBankId(orderRef);
    } catch (error: unknown) {
      stopPolling();
      setStep('ERROR');
      setErrorMessage(error instanceof Error ? error.message : 'Mock-BankID kunde inte godkännas.');
    } finally {
      setMockCompleteBusy(false);
    }
  };

  const handleAdminLogin = async (credentials?: { username: string; password: string }) => {
    setAdminBusy(true);
    setErrorMessage('');
    const username = credentials?.username ?? adminUsername.trim();
    const password = credentials?.password ?? adminPassword;
    try {
      const res = await callApi<{
        ok: boolean;
        accessToken: string;
        refreshToken: string;
        user: { id: string; role: string; organisationId: string };
      }>('/api/admin/auth/login', {
        method: 'POST',
        auth: false,
        body: { username, password },
      });
      if (!res?.accessToken) {
        throw new Error('Saknade sessionstoken från servern.');
      }
      setSession({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      onLogin({
        id: res.user.id,
        name: 'Administratör',
        personalNumber: '',
        isAuthenticated: true,
      });
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Admininloggning misslyckades.');
    } finally {
      setAdminBusy(false);
    }
  };

  const handleGoogleLogin = () => {
    // This will redirect the entire window to the backend endpoint,
    // which then redirects to the Google login page. After successful
    // login, Google calls back to the backend, which then redirects
    // back to the frontend application's main page.
    window.location.href = '/api/auth/google/login';
  };
  // Tomt = QR-flöde; 12 siffror = samma enhet. 1–11 siffror = ofullständigt personnummer.
  const personnummerSyntaktisktOk = personalNumber.length === 0 || personalNumber.length === 12;
  const canTryBankId = personnummerSyntaktisktOk;
  const bankIdBlocked = bankIdStatus?.canInitiate === false;
  const useAdminFirst = isAdminOnlyLogin || bankIdStatus?.mode === 'unconfigured' || bankIdBlocked;

  const adminBlock = (
    <div className="rounded-2xl border border-indigo-400/25 bg-indigo-500/10 px-4 py-4 text-left">
      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-200 mb-1">
        {isAdminOnlyLogin
          ? 'Administratörsinloggning'
          : useAdminFirst
            ? 'Gå vidare utan BankID'
            : 'Administratör (lösenord)'}
      </p>
      {isAdminOnlyLogin && (
        <p className="text-xs text-indigo-100/90 mb-3">
          BankID är avstängt i denna vy via{' '}
          <span className="font-mono text-[11px]">VITE_LOGIN_ADMIN_ONLY=true</span>. Backend{' '}
          <span className="font-mono text-[11px]">/api/auth/bankid/*</span> finns kvar för andra funktioner.
          Sätt <span className="font-mono text-[11px]">ADMIN_CONSOLE_PASSWORD</span> i serverns{' '}
          <span className="font-mono text-[11px]">.env</span> (t.ex. enligt{' '}
          <span className="font-mono text-[11px]">.env.example</span>).
        </p>
      )}
      {useAdminFirst && !isAdminOnlyLogin && (
        <p className="text-xs text-indigo-100/90 mb-3">
          När avtal eller certifikat saknas: logga in här (samma API som karta/fastighet). Sätt{' '}
          <span className="font-mono text-[11px]">ADMIN_CONSOLE_PASSWORD</span> i serverns{' '}
          <span className="font-mono text-[11px]">.env</span>, t.ex. värdet i{' '}
          <span className="font-mono text-[11px]">.env.example</span>.
        </p>
      )}
      {!useAdminFirst && (
        <p className="text-xs text-slate-400 mb-3">
          När BankID-avtal eller certifikat saknas: logga in här så att arbete med karta och fastighet kan
          fortsätta.
        </p>
      )}
      <div className="space-y-2">
        <input
          type="text"
          autoComplete="username"
          aria-label="Användarnamn"
          value={adminUsername}
          onChange={(e) => setAdminUsername(e.target.value)}
          placeholder="Användarnamn"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Lösenord"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          placeholder="Lösenord"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <button
          type="button"
          onClick={() => void handleAdminLogin()}
          disabled={adminBusy}
          className="w-full rounded-xl bg-slate-200 py-3 text-sm font-black text-slate-900 disabled:opacity-50"
        >
          {adminBusy ? 'Loggar in...' : 'Logga in som administratör'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] bg-indigo-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[40%] -right-[20%] w-[80%] h-[80%] bg-emerald-500/10 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[3rem] p-12 shadow-2xl relative z-10"
      >
        <div className="flex justify-center mb-10">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-shield-halved text-white text-3xl" />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {(step === 'IDLE' || step === 'STARTING' || step === 'ERROR') && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center">
                <div className="mb-8">
                  <button
                    onClick={handleGoogleLogin}
                    className="w-full py-4 bg-white/90 rounded-2xl font-bold text-lg text-slate-900 hover:bg-white transition-colors flex items-center justify-center gap-3 border border-white/10 shadow-lg shadow-white/10"
                  >
                    <svg className="w-6 h-6" viewBox="0 0 48 48">
                      <path
                        fill="#FFC107"
                        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                      ></path>
                      <path
                        fill="#FF3D00"
                        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
                      ></path>
                      <path
                        fill="#4CAF50"
                        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
                      ></path>
                      <path
                        fill="#1976D2"
                        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.012 35.24 44 30.025 44 24c0-1.341-.138-2.65-.389-3.917z"
                      ></path>
                    </svg>
                    Logga in med Google
                  </button>
                </div>
                <h1 className="text-3xl font-black text-white tracking-tighter italic mb-2">Välkommen.</h1>
                <p className="text-slate-400 text-sm font-medium">
                  {isAdminOnlyLogin
                    ? 'Endast administratörsinloggning. BankID är dolt i denna vy (serverns BankID-API:er och andra e‑leg-flöden påverkas inte).'
                    : useAdminFirst
                      ? 'BankID är inte igång på servern — använd administratör nedan, eller starta lokal test med BankID-mock (se .env.example).'
                      : 'Identifiera dig med BankID — eller fortsätt som administratör om BankID ännu inte är aktiverat hos er.'}
                </p>
              </div>

              {!isAdminOnlyLogin && bankIdStatus && bankIdStatus.mode === 'unconfigured' && (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {bankIdStatus.message}
                </div>
              )}

              {!isAdminOnlyLogin && bankIdStatus && bankIdStatus.mode === 'mock' && (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100/95">
                  Utvecklingsläge: när du startar BankID öppnas ett litet fönster som simulerar signering.
                  Tillåt popup för denna sajt, annars hänger flödet kvar.
                </div>
              )}

              {useAdminFirst && adminBlock}

              {isAdminOnlyLogin && errorMessage && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {errorMessage}
                </div>
              )}

              {!isAdminOnlyLogin && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4">
                      Personnummer (valfritt: lämna tomt för QR, eller 12 siffror samma enhet)
                    </label>
                    <input
                      type="text"
                      value={personalNumber}
                      onChange={(e) => setPersonalNumber(e.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="198501011234"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold tracking-widest outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                    />
                  </div>
                  <button
                    onClick={() => void handleStart()}
                    disabled={!canTryBankId || step === 'STARTING'}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-black py-5 rounded-2xl text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-indigo-500/20"
                  >
                    {step === 'STARTING' ? 'Startar BankID...' : 'Öppna BankID'}
                  </button>
                  {errorMessage && (
                    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                      {errorMessage}
                    </div>
                  )}

                  {!useAdminFirst && adminBlock}
                </div>
              )}
            </motion.div>
          )}

          {step === 'SCAN' && (
            <motion.div
              key="scan"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="text-center space-y-8"
            >
              <div className="relative w-48 h-48 mx-auto rounded-[2rem] border-2 border-indigo-500/40 bg-slate-900/80 px-5 py-6 flex flex-col items-center justify-center">
                <i className="fas fa-qrcode text-6xl text-indigo-400 mb-4" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">Order</p>
                <p className="mt-2 text-xs font-mono text-slate-300 break-all">{orderRef}</p>
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight italic mb-2">
                  Väntar på BankID...
                </h2>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">
                  {launchMode === 'mock' ? 'Verifierad anslutning etableras' : 'Bekräfta i din BankID-app'}
                </p>
                {launchMode === 'mock' && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Inget fönster? Använd knappen nedan för att godkänna mock-flödet direkt.
                  </p>
                )}
                {hintCode && <p className="mt-3 text-sm text-slate-300">{hintCode}</p>}
                {qrPayload && (
                  <p className="mt-3 rounded-xl bg-white/5 px-4 py-3 text-[11px] text-slate-400 font-mono break-all">
                    {qrPayload}
                  </p>
                )}
              </div>
              {launchMode === 'mock' && (
                <button
                  type="button"
                  onClick={() => void handleMockComplete()}
                  disabled={mockCompleteBusy}
                  className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {mockCompleteBusy ? 'Godkänner...' : 'Godkänn mock-BankID här'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-300 hover:bg-white/10"
              >
                Avbryt
              </button>
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
                <i className="fas fa-check text-white text-4xl" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight italic mb-2">Inloggad</h2>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">
                  Session etablerad mot backend
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-12 pt-8 border-t border-white/5 flex justify-center gap-6 opacity-40">
          <i className="fas fa-lock text-white text-sm" />
          <i className="fas fa-fingerprint text-white text-sm" />
          <i className="fas fa-id-card text-white text-sm" />
        </div>
      </motion.div>
    </div>
  );
};

export default BankIDLogin;
