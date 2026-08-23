import { useMutation } from '@tanstack/react-query';
import { initiateBankId, collectBankId, cancelBankId, logout as logoutApi } from '../api-client/auth.client';
import { useState, useEffect } from 'react';

export interface BankIdLoginResult {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; role: string; organisationId: string; bankidId?: string; displayName?: string };
}

/**
 * PRODUCT-AUTH-USER-LOGIN-UX-01 Phase B.
 *
 * `onComplete` is the ONLY place session state is written -- this hook itself never touches
 * localStorage or reloads the page. The caller (AppShell) is expected to route the result
 * through the same coreApiClient.setSession()/AppSessionProvider.onLoginSuccess() path the
 * dev-login button already uses, so BankID and dev-login produce an identically-shaped
 * session from the app's point of view; the server's own bootstrap (never the login response
 * itself) remains the sole source of truth for which project becomes active.
 */
export function useBankIdAuth(onComplete?: (result: BankIdLoginResult) => void) {
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<'idle' | 'pending' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const initMutation = useMutation({
    mutationFn: () => initiateBankId(),
    onSuccess: (data) => {
      setOrderRef(data.orderRef);
      setAuthStatus('pending');
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
      setAuthStatus('failed');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => (orderRef ? cancelBankId(orderRef) : Promise.resolve()),
    onSuccess: () => {
      setOrderRef(null);
      setAuthStatus('idle');
    },
  });

  // Polling logic
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (authStatus === 'pending' && orderRef) {
      timer = setInterval(async () => {
        try {
          const res = await collectBankId(orderRef);
          if (res.status === 'complete') {
            setAuthStatus('complete');
            clearInterval(timer);
            if (res.accessToken && res.user) {
              onComplete?.({
                accessToken: res.accessToken,
                refreshToken: res.refreshToken,
                user: res.user,
              });
            } else {
              setAuthStatus('failed');
              setError('BankID-svaret saknade sessionsdata.');
            }
          } else if (res.status === 'failed') {
            setAuthStatus('failed');
            setError(res.hintCode || 'Inloggning misslyckades');
            clearInterval(timer);
          }
        } catch {
          setError('Anslutningsfel vid verifiering');
          clearInterval(timer);
        }
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [authStatus, orderRef, onComplete]);

  return {
    initiate: () => initMutation.mutate(),
    cancel: () => cancelMutation.mutate(),
    order: initMutation.data,
    status: authStatus,
    error,
    isInitializing: initMutation.isPending,
  };
}

/** Server-side revocation, given the tokens actually being logged out (never read from storage here). */
export async function logout(accessToken?: string, refreshToken?: string): Promise<void> {
  await logoutApi(accessToken, refreshToken);
}
