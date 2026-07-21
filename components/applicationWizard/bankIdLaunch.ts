export function bankIdDeepLink(autoStartToken: string | null): string | null {
  if (!autoStartToken) return null;
  return `bankid:///?autostarttoken=${encodeURIComponent(autoStartToken)}&redirect=null`;
}

function resolveCurrentOrigin(currentOrigin?: string | null): string | null {
  if (currentOrigin) return currentOrigin;
  if (typeof window !== 'undefined') return window.location.origin;
  return null;
}

export function normalizeMockBankIdLaunchUrl(
  launchUrl: string | null,
  currentOrigin?: string | null,
): string | null {
  if (!launchUrl) return null;

  const origin = resolveCurrentOrigin(currentOrigin);
  if (!origin) return launchUrl;

  try {
    const parsed = new URL(launchUrl, origin);
    if (parsed.pathname.startsWith('/api/auth/bankid/mock/launch/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return launchUrl;
  }
}

export function resolveBankIdLaunchHref(input: {
  autoStartToken: string | null;
  launchMode: 'bankid' | 'mock' | null;
  launchUrl: string | null;
  currentOrigin?: string | null;
}): string | null {
  if (input.launchMode === 'mock') {
    return normalizeMockBankIdLaunchUrl(input.launchUrl, input.currentOrigin);
  }

  return bankIdDeepLink(input.autoStartToken);
}

export function resolveBankIdLaunchLabel(launchMode: 'bankid' | 'mock' | null): string {
  return launchMode === 'mock' ? 'Oppna Mock BankID' : 'Oppna BankID-appen';
}
