import React, { useMemo, useState, type ReactNode } from 'react';
import { useDebounce } from '../hooks/useDebounce';

interface Column<T extends Record<string, unknown>, K extends keyof T = keyof T> {
  key: K;
  label: string;
  sortable?: boolean;
  render?: (value: T[K], row: T) => ReactNode;
  width?: string;
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[];
  columns: Column<T>[];
  rowKey: keyof T;
  searchable?: boolean;
  searchFields?: (keyof T)[];
  paginate?: boolean;
  pageSize?: number;
  className?: string;
}

type SortOrder = 'asc' | 'desc' | null;

/**
 * Data table component with sorting, filtering, and pagination
 */
export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  rowKey,
  searchable = false,
  searchFields = [],
  paginate = false,
  pageSize = 10,
  className = '',
}: DataTableProps<T>): React.JSX.Element {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const filteredData = useMemo(() => {
    let result = [...data];

    if (debouncedSearchTerm && searchFields.length > 0) {
      result = result.filter((row) =>
        searchFields.some((field) =>
          String(row[field]).toLowerCase().includes(debouncedSearchTerm.toLowerCase()),
        ),
      );
    }

    if (sortKey && sortOrder) {
      result.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
          if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
          return 0;
        }

        const aText = String(aVal ?? '');
        const bText = String(bVal ?? '');
        if (aText < bText) return sortOrder === 'asc' ? -1 : 1;
        if (aText > bText) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, debouncedSearchTerm, sortKey, sortOrder, searchFields]);

  const paginatedData = useMemo(() => {
    if (!paginate) return filteredData;
    const startIdx = (currentPage - 1) * pageSize;
    return filteredData.slice(startIdx, startIdx + pageSize);
  }, [filteredData, currentPage, pageSize, paginate]);

  const totalPages = Math.ceil(filteredData.length / pageSize);

  const handleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : sortOrder === 'desc' ? null : 'asc');
      if (sortOrder === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const getSortIcon = (key: keyof T) => {
    if (sortKey !== key) return '↕';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {searchable && (
        <div className="relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Sök..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-6 py-3 text-left font-bold text-slate-900 ${col.sortable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-2">
                    {col.label}
                    {col.sortable && <span className="text-xs text-slate-400">{getSortIcon(col.key)}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length > 0 ? (
              paginatedData.map((row, idx) => (
                <tr key={String(row[rowKey])} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-6 py-4 text-slate-700">
                      {col.render ? col.render(row[col.key], row) : String(row[col.key])}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-6 py-8 text-center text-slate-500">
                  Inga resultat
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginate && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Sida {currentPage} av {totalPages} ({filteredData.length} resultat)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              Föregående
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              Nästa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
