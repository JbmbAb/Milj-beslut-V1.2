import { describe, expect, it } from 'vitest';
import {
  normalizeMockBankIdLaunchUrl,
  resolveBankIdLaunchHref,
  resolveBankIdLaunchLabel,
} from '../../components/applicationWizard/bankIdLaunch';

describe('ApplicationWizard BankID launch helpers', () => {
  it('uses the mock launch url when mock mode is active', () => {
    expect(
      resolveBankIdLaunchHref({
        autoStartToken: 'auto-token',
        launchMode: 'mock',
        launchUrl: '/api/auth/bankid/mock/launch/order-1',
        currentOrigin: 'http://127.0.0.1:3000',
      }),
    ).toBe('/api/auth/bankid/mock/launch/order-1');
    expect(resolveBankIdLaunchLabel('mock')).toBe('Oppna Mock BankID');
  });

  it('normalizes absolute mock launch urls to the current app origin', () => {
    expect(
      normalizeMockBankIdLaunchUrl(
        'http://localhost:3000/api/auth/bankid/mock/launch/order-1',
        'http://127.0.0.1:3000',
      ),
    ).toBe('/api/auth/bankid/mock/launch/order-1');
  });

  it('falls back to a native BankID deeplink outside mock mode', () => {
    expect(
      resolveBankIdLaunchHref({
        autoStartToken: 'auto-token',
        launchMode: 'bankid',
        launchUrl: null,
        currentOrigin: 'http://127.0.0.1:3000',
      }),
    ).toBe('bankid:///?autostarttoken=auto-token&redirect=null');
    expect(resolveBankIdLaunchLabel('bankid')).toBe('Oppna BankID-appen');
  });
});
