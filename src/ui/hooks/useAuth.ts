import { useMutation } from '@tanstack/react-query';
import { initiateBankId, collectBankId, cancelBankId, logout } from '../api-client/auth.client';
import { useState, useEffect } from 'react';

export function useBankIdAuth() {
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<'idle' | 'pending' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const initMutation = useMutation({
    mutationFn: initiateBankId,
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
    let timer: NodeJS.Timeout;
    if (authStatus === 'pending' && orderRef) {
      timer = setInterval(async () => {
        try {
          const res = await collectBankId(orderRef);
          if (res.status === 'complete') {
            setAuthStatus('complete');
            clearInterval(timer);
            // Save tokens to local storage or handle session
            if (res.accessToken) {
              localStorage.setItem('miljobeslut_admin_bearer', res.accessToken);
            }
            window.location.reload(); // Simple way to refresh app state
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
  }, [authStatus, orderRef]);

  return {
    initiate: () => initMutation.mutate(undefined),
    cancel: () => cancelMutation.mutate(undefined),
    logout: () =>
      logout().then(() => {
        localStorage.removeItem('miljobeslut_admin_bearer');
        window.location.reload();
      }),
    order: initMutation.data,
    status: authStatus,
    error,
    isInitializing: initMutation.isPending,
  };
}
