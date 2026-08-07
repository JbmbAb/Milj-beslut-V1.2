export interface SourceDocument {
  name: string;
  content: string; // Råtext eller rådata
  sourceUrl: string;
}

export interface HarvestedCase {
  authority: string; // Myndighet t.ex. 'Dalarna' (MPD) eller 'Nacka' (MMD)
  caseId: string;
  year: number;
  municipality: string;
  sourceUrl: string;
  documents: SourceDocument[];
}

export interface SourceAdapter {
  id: string; // Unikt ID för adaptern t.ex. 'MMD' eller 'MPD'
  title: string;
  fetchCases(onlyFilter?: string[]): Promise<HarvestedCase[]>;
}
