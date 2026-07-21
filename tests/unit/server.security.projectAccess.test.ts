import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validatePropertyLookupInput,
  assertPermission,
  assertProjectAccess,
} from '../../server/security/projectAccess';
import type { AuthUser } from '../../server/security/types';

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(),
}));

import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';

describe('server/security/projectAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validatePropertyLookupInput', () => {
    it('accepts valid property lookup input', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).not.toThrow();
    });

    it('throws when projectId is missing', () => {
      const input = {
        projectId: '',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'projectId, propertyDesignation and purpose are required',
      );
    });

    it('throws when propertyDesignation is missing', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: '',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'projectId, propertyDesignation and purpose are required',
      );
    });

    it('throws when purpose is missing', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: '',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'projectId, propertyDesignation and purpose are required',
      );
    });

    it('rejects bulk lookup attempts with comma separator', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1, STOCKHOLM 1:2',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('rejects wildcard lookups with asterisk', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM *',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('rejects lookups with forbidden tokens (semicolon)', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1; DROP TABLE properties;',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('rejects lookups with boolean operators (OR)', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1 OR STOCKHOLM 1:2',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('rejects lookups with boolean operators (AND)', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1 AND STOCKHOLM 1:2',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('rejects lookups with percent wildcard', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM %',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('handles whitespace around designation', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: '  STOCKHOLM 1:1  ',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).not.toThrow();
    });

    it('case insensitive OR detection', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1 or STOCKHOLM 1:2',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });

    it('case insensitive AND detection', () => {
      const input = {
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1 and STOCKHOLM 1:2',
        purpose: 'Environmental assessment',
      };

      expect(() => validatePropertyLookupInput(input)).toThrow(
        'Bulk or wildcard property lookup is not allowed',
      );
    });
  });

  describe('assertPermission', () => {
    it('allows ADMIN with PROPERTY_LOOKUP permission', () => {
      const user: AuthUser = {
        id: 'admin1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'ADMIN',
      };

      expect(() => assertPermission(user, 'PROPERTY_LOOKUP')).not.toThrow();
    });

    it('allows ADMIN with AUDIT_EXPORT permission', () => {
      const user: AuthUser = {
        id: 'admin1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'ADMIN',
      };

      expect(() => assertPermission(user, 'AUDIT_EXPORT')).not.toThrow();
    });

    it('allows CONSULTANT with PROPERTY_LOOKUP', () => {
      const user: AuthUser = {
        id: 'consultant1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      expect(() => assertPermission(user, 'PROPERTY_LOOKUP')).not.toThrow();
    });

    it('denies CONSULTANT AUDIT_EXPORT', () => {
      const user: AuthUser = {
        id: 'consultant1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      expect(() => assertPermission(user, 'AUDIT_EXPORT')).toThrow('Insufficient role permissions');
    });

    it('allows AUDITOR with both PROPERTY_LOOKUP and AUDIT_EXPORT', () => {
      const user: AuthUser = {
        id: 'auditor1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'AUDITOR',
      };

      expect(() => assertPermission(user, 'PROPERTY_LOOKUP')).not.toThrow();
      expect(() => assertPermission(user, 'AUDIT_EXPORT')).not.toThrow();
    });

    it('denies BANK any permissions', () => {
      const user: AuthUser = {
        id: 'bank1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'BANK',
      };

      expect(() => assertPermission(user, 'PROPERTY_LOOKUP')).toThrow('Insufficient role permissions');
      expect(() => assertPermission(user, 'AUDIT_EXPORT')).toThrow('Insufficient role permissions');
    });

    it('denies undefined permissions for all roles', () => {
      const user: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'ADMIN',
      };

      expect(() => assertPermission(user, 'UNKNOWN_PERMISSION')).toThrow('Insufficient role permissions');
    });
  });

  describe('assertProjectAccess', () => {
    it('verifies project membership for user', async () => {
      const user: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      vi.mocked(assertProjectMembership).mockResolvedValue(undefined);

      await assertProjectAccess(user, 'proj123', 'org1');

      expect(assertProjectMembership).toHaveBeenCalledWith({
        projectId: 'proj123',
        userId: 'user1',
        organisationId: 'org1',
      });
    });

    it('requires membership even for ADMIN users', async () => {
      const user: AuthUser = {
        id: 'admin1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'ADMIN',
      };

      vi.mocked(assertProjectMembership).mockResolvedValue(undefined);

      await assertProjectAccess(user, 'proj123', 'org1');

      expect(assertProjectMembership).toHaveBeenCalledWith({
        projectId: 'proj123',
        userId: 'admin1',
        organisationId: 'org1',
      });
    });

    it('throws when user is not project member', async () => {
      const user: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      vi.mocked(assertProjectMembership).mockRejectedValue(new Error('Not a project member'));

      await expect(assertProjectAccess(user, 'proj123', 'org1')).rejects.toThrow('Not a project member');
    });

    it('passes correct organization ID to assertion', async () => {
      const user: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      vi.mocked(assertProjectMembership).mockResolvedValue(undefined);

      await assertProjectAccess(user, 'proj123', 'org2');

      expect(assertProjectMembership).toHaveBeenCalledWith({
        projectId: 'proj123',
        userId: 'user1',
        organisationId: 'org2',
      });
    });

    it('handles database errors gracefully', async () => {
      const user: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };

      vi.mocked(assertProjectMembership).mockRejectedValue(new Error('Database connection failed'));

      await expect(assertProjectAccess(user, 'proj123', 'org1')).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('allows different users with valid membership', async () => {
      const user1: AuthUser = {
        id: 'user1',
        organisationId: 'org1',
        bankidId: 'bid1',
        role: 'CONSULTANT',
      };
      const user2: AuthUser = {
        id: 'user2',
        organisationId: 'org1',
        bankidId: 'bid2',
        role: 'AUDITOR',
      };

      vi.mocked(assertProjectMembership).mockResolvedValue(undefined);

      await assertProjectAccess(user1, 'proj123', 'org1');
      await assertProjectAccess(user2, 'proj123', 'org1');

      expect(assertProjectMembership).toHaveBeenCalledTimes(2);
      expect(assertProjectMembership).toHaveBeenNthCalledWith(1, {
        projectId: 'proj123',
        userId: 'user1',
        organisationId: 'org1',
      });
      expect(assertProjectMembership).toHaveBeenNthCalledWith(2, {
        projectId: 'proj123',
        userId: 'user2',
        organisationId: 'org1',
      });
    });
  });
});
