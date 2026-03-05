import { describe, expect, it } from 'vitest';
import { assertPermission, validatePropertyLookupInput } from '../../server/security/projectAccess';

describe('projectAccess', () => {
  it('rejects invalid property lookup payloads', () => {
    expect(() =>
      validatePropertyLookupInput({
        projectId: '',
        propertyDesignation: '',
        purpose: '',
      }),
    ).toThrow();

    expect(() =>
      validatePropertyLookupInput({
        projectId: 'project-1',
        propertyDesignation: 'ABC*',
        purpose: 'test',
      }),
    ).toThrow(/not allowed/i);
  });

  it('allows admin and blocks unauthorized role', () => {
    expect(() =>
      assertPermission(
        { id: 'u1', role: 'ADMIN', organisationId: 'org-1', bankidId: 'bid-1' },
        'AUDIT_EXPORT',
      ),
    ).not.toThrow();

    expect(() =>
      assertPermission(
        { id: 'u2', role: 'BANK', organisationId: 'org-1', bankidId: 'bid-2' },
        'PROPERTY_LOOKUP',
      ),
    ).toThrow(/permission/i);
  });
});
