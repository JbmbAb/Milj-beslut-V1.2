import { describe, expect, it } from 'vitest';
import { selectPreferredSewageTechnology } from '../../server/modules/sewage/technologySelector';

describe('selectPreferredSewageTechnology', () => {
  it('returns first recommended system that is not blocked', () => {
    const selected = selectPreferredSewageTechnology({
      recommendedSystems: ['INFILTRATION', 'CLOSED_TANK', 'MINI_PLANT_BDT'],
      blockedSystems: ['CLOSED_TANK'],
    });

    expect(selected).toBe('INFILTRATION');
  });

  it('returns null when all recommended systems are blocked', () => {
    const selected = selectPreferredSewageTechnology({
      recommendedSystems: ['MINI_PLANT_BDT'],
      blockedSystems: ['MINI_PLANT_BDT'],
    });

    expect(selected).toBeNull();
  });

  it('returns null when no recommendations exist', () => {
    const selected = selectPreferredSewageTechnology({
      recommendedSystems: [],
      blockedSystems: [],
    });

    expect(selected).toBeNull();
  });
});
