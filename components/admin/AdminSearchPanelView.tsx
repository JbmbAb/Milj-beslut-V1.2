import React from 'react';
import type {
  SearchFilters,
  SearchMode,
  SearchQueryResponse,
  SearchStatusResponse,
} from '../../types';
import SearchAndSyncPanel from './SearchAndSyncPanel';
import SearchResultsTable from './SearchResultsTable';
import IndexStatusPanel from './IndexStatusPanel';

interface AdminSearchPanelViewProps {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  searchMode: SearchMode;
  setSearchMode: React.Dispatch<React.SetStateAction<SearchMode>>;
  topK: number;
  setTopK: React.Dispatch<React.SetStateAction<number>>;
  strictEvidence: boolean;
  setStrictEvidence: React.Dispatch<React.SetStateAction<boolean>>;
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  projectId: string;
  busy: string;
  token: string;
  runSearch: () => Promise<void>;
  syncRegistry: () => Promise<void>;
  searchStatus: SearchStatusResponse | null;
  searchData: SearchQueryResponse | null;
}

const AdminSearchPanelView: React.FC<AdminSearchPanelViewProps> = ({
  query,
  setQuery,
  searchMode,
  setSearchMode,
  topK,
  setTopK,
  strictEvidence,
  setStrictEvidence,
  filters,
  setFilters,
  projectId,
  busy,
  token,
  runSearch,
  syncRegistry,
  searchStatus,
  searchData,
}) => (
  <div className="space-y-10">
    <SearchAndSyncPanel
      query={query}
      setQuery={setQuery}
      searchMode={searchMode}
      setSearchMode={setSearchMode}
      topK={topK}
      setTopK={setTopK}
      strictEvidence={strictEvidence}
      setStrictEvidence={setStrictEvidence}
      filters={filters}
      setFilters={setFilters}
      projectId={projectId}
      busy={busy}
      token={token}
      runSearch={runSearch}
      syncRegistry={syncRegistry}
      syncStatus={busy === 'sync' ? 'RUNNING' : 'IDLE'}
      searchStatus={searchStatus}
    />

    <SearchResultsTable searchResults={searchData} />
    <IndexStatusPanel searchStatus={searchStatus} />
  </div>
);

export default AdminSearchPanelView;
