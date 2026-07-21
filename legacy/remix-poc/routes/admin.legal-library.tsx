import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { BookOpen, Scale, FileText, CheckCircle2, AlertCircle } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  // Isolerar node-beroenden så de inte hamnar i klient-bundlen
  const fs = await import('node:fs');
  const path = await import('node:path');

  const H_DRIVE_ROOT = process.env.H_DRIVE_ROOT || 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
  const BASE_DOC_DIR = path.join(H_DRIVE_ROOT, 'Documents', 'Sources');

  interface LegalDocument {
    provider: string;
    dataset: string;
    version: string;
    downloadedAt: string;
    files: string[];
    status: 'Verified' | 'Pending' | 'Quarantine';
  }

  const documents: LegalDocument[] = [];

  const findManifests = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findManifests(fullPath);
      } else if (entry.name === 'manifest.json') {
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          documents.push({
            provider: content.provider || 'Okänd',
            dataset: content.dataset || 'Okänd',
            version: content.version || 'Okänd',
            downloadedAt: content.downloaded_at || new Date().toISOString(),
            files: content.files || [],
            status: content.content_bundle_sha256 ? 'Verified' : 'Pending'
          });
        } catch (e) {
          console.error(`Kunde inte läsa manifest: ${fullPath}`, e);
        }
      }
    }
  };

  findManifests(BASE_DOC_DIR);

  return json({
    documents: documents.sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime()),
    archiveRoot: BASE_DOC_DIR
  });
}

export default function LegalLibraryView() {
  const { documents, archiveRoot } = useLoaderData<typeof loader>();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
          <Scale className="w-8 h-8 text-blue-600" />
          Juridiskt Bibliotek (Mimers Brunn)
        </h1>
        <p className="text-slate-600 mt-2">
          Intern granskningsvy för den Rättsliga Kunskapsbasen (RAG). Visar dokument fysiskt säkrade i Master-arkivet.
        </p>
        <div className="text-xs text-slate-400 mt-1 font-mono">
          Källa: {archiveRoot}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <span className="text-slate-500 text-sm font-medium">Totalt antal källor</span>
          <span className="text-3xl font-bold text-slate-800">{documents.length}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <span className="text-slate-500 text-sm font-medium">Indexerade Filer</span>
          <span className="text-3xl font-bold text-slate-800">
            {documents.reduce((acc, doc) => acc + doc.files.length, 0)}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="p-4 font-semibold text-slate-700">Källa (Myndighet)</th>
              <th className="p-4 font-semibold text-slate-700">Dataset / Lagrum</th>
              <th className="p-4 font-semibold text-slate-700">Version / Datum</th>
              <th className="p-4 font-semibold text-slate-700">Filer</th>
              <th className="p-4 font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  Inga juridiska dokument hittades i arkivet. Kör <code>legal-corpus-harvest.ts</code>.
                </td>
              </tr>
            ) : (
              documents.map((doc, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 flex items-center gap-3">
                    <BookOpen className="w-5 h-5 text-slate-400" />
                    <span className="font-medium text-slate-700">{doc.provider}</span>
                  </td>
                  <td className="p-4 text-slate-600">{doc.dataset}</td>
                  <td className="p-4">
                    <div className="text-slate-700 font-mono text-sm">{doc.version}</div>
                    <div className="text-slate-400 text-xs">Hämtad: {new Date(doc.downloadedAt).toLocaleDateString('sv-SE')}</div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-600">{doc.files.length} st</span>
                    </div>
                  </td>
                  <td className="p-4">
                    {doc.status === 'Verified' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verifierad (SHA256)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Väntar indexering
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

