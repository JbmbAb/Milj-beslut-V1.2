/**
 * querySort.ts
 *
 * Generisk parser för sort/order/pagination-parametrar i listning-endpoints.
 * Garanterar whitelist på sortnycklar, klampar pageSize, och returnerar
 * normaliserade värden som kan användas direkt i Prisma orderBy.
 *
 * Används av legal.routes.ts och kan återanvändas på fler listor för
 * konsekvent semantik.
 */

export type SortOrder = 'asc' | 'desc';

export interface ListQueryOptions<TSort extends readonly string[]> {
  sortKeys: TSort;
  defaultSort: TSort[number];
  defaultOrder?: SortOrder;
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface ParsedListQuery<TSort extends readonly string[]> {
  sort: TSort[number];
  order: SortOrder;
  page: number;
  pageSize: number;
}

function toPositiveInt(value: unknown, fallback: number, max?: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  const rounded = Math.floor(raw);
  return max !== undefined ? Math.min(rounded, max) : rounded;
}

export function parseListQuery<TSort extends readonly string[]>(
  query: Record<string, unknown>,
  options: ListQueryOptions<TSort>,
): ParsedListQuery<TSort> {
  const defaultOrder: SortOrder = options.defaultOrder ?? 'desc';
  const defaultPageSize = options.defaultPageSize ?? 25;
  const maxPageSize = options.maxPageSize ?? 100;

  const rawSort = typeof query.sort === 'string' ? query.sort : '';
  const sort: TSort[number] = (options.sortKeys as readonly string[]).includes(rawSort)
    ? (rawSort as TSort[number])
    : options.defaultSort;

  const rawOrder = typeof query.order === 'string' ? query.order.toLowerCase() : '';
  const order: SortOrder = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : defaultOrder;

  const page = toPositiveInt(query.page, 1);
  const pageSize = toPositiveInt(query.pageSize, defaultPageSize, maxPageSize);

  return { sort, order, page, pageSize };
}

/**
 * Hjälpfunktion som bygger en Prisma-kompatibel `orderBy`-array med
 * tie-breaker på id (desc) för stabil pagination.
 */
export function buildStableOrderBy(
  sortKey: string,
  order: SortOrder,
  idKey: string = 'id',
): Array<Record<string, SortOrder>> {
  return [{ [sortKey]: order }, { [idKey]: 'desc' }];
}
