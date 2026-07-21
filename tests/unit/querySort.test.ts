import { describe, expect, it } from 'vitest';
import { parseListQuery, buildStableOrderBy } from '../../server/lib/querySort';

describe('querySort.parseListQuery', () => {
  const SORT_KEYS = ['createdAt', 'updatedAt', 'title'] as const;

  it('returnerar default-värden när query är tom', () => {
    const res = parseListQuery(
      {},
      {
        sortKeys: SORT_KEYS,
        defaultSort: 'createdAt',
      },
    );
    expect(res.sort).toBe('createdAt');
    expect(res.order).toBe('desc');
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(25);
  });

  it('respekterar whitelist på sort', () => {
    const res = parseListQuery(
      { sort: 'title' },
      {
        sortKeys: SORT_KEYS,
        defaultSort: 'createdAt',
      },
    );
    expect(res.sort).toBe('title');
  });

  it('avvisar sort som inte finns i whitelist', () => {
    const res = parseListQuery(
      { sort: 'dangerous_field' },
      {
        sortKeys: SORT_KEYS,
        defaultSort: 'createdAt',
      },
    );
    expect(res.sort).toBe('createdAt');
  });

  it('klampar pageSize mot max', () => {
    const res = parseListQuery(
      { pageSize: '5000' },
      {
        sortKeys: SORT_KEYS,
        defaultSort: 'createdAt',
        maxPageSize: 100,
      },
    );
    expect(res.pageSize).toBe(100);
  });

  it('fallback på defaultPageSize när pageSize är ogiltig', () => {
    const res = parseListQuery(
      { pageSize: 'abc' },
      {
        sortKeys: SORT_KEYS,
        defaultSort: 'createdAt',
        defaultPageSize: 10,
      },
    );
    expect(res.pageSize).toBe(10);
  });

  it('normaliserar order till lowercase och tillåter bara asc/desc', () => {
    expect(parseListQuery({ order: 'ASC' }, { sortKeys: SORT_KEYS, defaultSort: 'createdAt' }).order).toBe(
      'asc',
    );
    expect(
      parseListQuery({ order: 'invalid' }, { sortKeys: SORT_KEYS, defaultSort: 'createdAt' }).order,
    ).toBe('desc');
  });

  it('skyddar mot negativa sidnummer', () => {
    const res = parseListQuery({ page: '-5' }, { sortKeys: SORT_KEYS, defaultSort: 'createdAt' });
    expect(res.page).toBe(1);
  });
});

describe('querySort.buildStableOrderBy', () => {
  it('lägger till id desc som tie-breaker', () => {
    const orderBy = buildStableOrderBy('createdAt', 'desc');
    expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('tillåter alternativt idKey', () => {
    const orderBy = buildStableOrderBy('name', 'asc', 'guid');
    expect(orderBy).toEqual([{ name: 'asc' }, { guid: 'desc' }]);
  });
});
