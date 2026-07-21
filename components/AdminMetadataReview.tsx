import React, { useEffect, useState } from 'react';

interface ReviewItem {
  id: string;
  documentId: string;
  queueType: 'LOW_CONFIDENCE' | 'DISAGREEMENT';
  fieldName: string;
  proposedValue: string | null;
  confidence: number | null;
  reason: string;
  createdAt: string;
  document: {
    id: string;
    subject: string;
    absolutePath: string;
    municipalityNormalized: string | null;
    legalStatus: string | null;
    decisionType: string | null;
    activityCode: string | null;
    wasteType: string | null;
  };
}

type ResolveAction = 'APPROVE' | 'REJECT' | 'CLEAR_PROPOSAL';

const AdminMetadataReview: React.FC = () => {
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hasProposals = queue.some((item) => item.proposedValue !== null && item.proposedValue !== '');

  const fetchQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('miljobeslut_admin_bearer');
      const response = await fetch('/api/v1/admin/review-queue', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.status === 401) {
        setError('Adminsessionen har gått ut. Logga in igen eller förnya token.');
        return;
      }
      if (data.ok) {
        setQueue(data.queue);
      } else {
        setError(data.error?.message || 'Kunde inte hämta kön.');
      }
    } catch {
      setError('Nätverksfel vid hämtning av granskningskön.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchQueue();
  }, []);

  const handleResolve = async (id: string, action: ResolveAction, newValue?: string) => {
    setBusyId(id);
    try {
      const token = localStorage.getItem('miljobeslut_admin_bearer');
      const response = await fetch(`/api/v1/admin/review-queue/${id}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, value: newValue }),
      });
      const data = await response.json();
      if (response.status === 401) {
        alert('Adminsessionen har gått ut. Logga in igen eller förnya token.');
        return;
      }
      if (!data.ok) {
        alert(`Fel vid hantering: ${data.error?.message || 'Okänt fel'}`);
        return;
      }

      if (action === 'CLEAR_PROPOSAL') {
        setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, proposedValue: null } : item)));
      } else {
        setQueue((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      alert('Nätverksfel vid inskickning.');
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAllProposals = async () => {
    const ids = queue
      .filter((item) => item.proposedValue !== null && item.proposedValue !== '')
      .map((item) => item.id);

    if (ids.length === 0) return;

    setBusyId('__bulk__');
    try {
      const token = localStorage.getItem('miljobeslut_admin_bearer');
      const response = await fetch('/api/v1/admin/review-queue/clear-proposals', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      const data = await response.json();
      if (response.status === 401) {
        alert('Adminsessionen har gått ut. Logga in igen eller förnya token.');
        return;
      }
      if (!data.ok) {
        alert(`Fel vid rensning: ${data.error?.message || 'Okänt fel'}`);
        return;
      }
      setQueue((prev) => prev.map((item) => ({ ...item, proposedValue: null })));
    } catch {
      alert('Nätverksfel vid rensning.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="p-10 font-bold text-slate-500">Laddar granskningskö...</div>;
  if (error)
    return <div className="rounded-xl border border-red-200 bg-red-50 p-10 text-red-600">{error}</div>;

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
            Systemadministration
          </p>
          <h2 className="text-2xl font-black text-slate-900">Kvalitetssäkring av metadata</h2>
          <p className="mt-1 text-sm text-slate-500">
            Granska och åtgärda konflikter eller låg tillförlitlighet i extraherad data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasProposals && (
            <button
              type="button"
              onClick={() => void handleClearAllProposals()}
              disabled={busyId === '__bulk__'}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-black text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyId === '__bulk__' ? 'Rensar förslag...' : 'Rensa föreslagna alternativ'}
            </button>
          )}
          <div className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">
            {queue.length} ärenden väntar på granskning
          </div>
        </div>
      </header>

      {queue.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <i className="fas fa-check-double text-2xl" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Kön är tom</h3>
          <p className="mx-auto mt-2 max-w-sm text-slate-500">
            Alla extraktioner har antingen hög tillförlitlighet eller har redan granskats manuellt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-indigo-300 md:flex-row"
            >
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                      item.queueType === 'DISAGREEMENT'
                        ? 'border-amber-200 bg-amber-100 text-amber-700'
                        : 'border-slate-200 bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.queueType === 'DISAGREEMENT' ? 'Konflikt' : 'Låg tillförlitlighet'}
                  </span>
                  <span className="text-xs text-slate-400">
                    Skapad: {new Date(item.createdAt).toLocaleDateString('sv-SE')}
                  </span>
                </div>

                <div>
                  <h4 className="text-lg font-bold leading-tight text-slate-900">{item.document.subject}</h4>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.document.absolutePath}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Fältnamn</p>
                    <p className="font-bold text-indigo-600">{item.fieldName}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Föreslaget värde</p>
                    <p className="font-bold">{item.proposedValue || 'Inget aktivt förslag'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Orsak</p>
                    <p className="text-sm text-slate-600">{item.reason}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-3 border-t border-slate-100 pt-4 md:w-64 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                <button
                  onClick={() => handleResolve(item.id, 'APPROVE')}
                  disabled={busyId === item.id}
                  className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyId === item.id ? 'Bearbetar...' : 'Godkänn förslag'}
                </button>
                <button
                  onClick={() => handleResolve(item.id, 'CLEAR_PROPOSAL')}
                  disabled={busyId === item.id || !item.proposedValue}
                  className="w-full rounded-xl border border-amber-200 bg-amber-50 py-3 font-bold text-amber-800 transition-all hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rensa förslag
                </button>
                <button
                  onClick={() => {
                    const newVal = prompt('Ange rätt värde manuellt:', item.proposedValue || '');
                    if (newVal !== null) void handleResolve(item.id, 'APPROVE', newVal);
                  }}
                  disabled={busyId === item.id}
                  className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white transition-all hover:bg-black disabled:opacity-50"
                >
                  Justera och godkänn
                </button>
                <button
                  onClick={() => handleResolve(item.id, 'REJECT')}
                  disabled={busyId === item.id}
                  className="w-full rounded-xl border border-slate-200 py-3 font-bold text-slate-500 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  Avslå (Behåll befintligt)
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminMetadataReview;
