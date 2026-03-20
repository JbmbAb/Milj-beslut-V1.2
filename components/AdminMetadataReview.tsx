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

const AdminMetadataReview: React.FC = () => {
    const [queue, setQueue] = useState<ReviewItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const fetchQueue = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = localStorage.getItem('miljobeslut_admin_bearer');
            const response = await fetch('/api/v1/admin/review-queue', {
                headers: { 'Authorization': `Bearer ${token}` }
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
            setError('Nätverksfel vid hämtning av granskningskö.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchQueue();
    }, []);

    const handleResolve = async (id: string, action: 'APPROVE' | 'REJECT', newValue?: string) => {
        setBusyId(id);
        try {
            const token = localStorage.getItem('miljobeslut_admin_bearer');
            const response = await fetch(`/api/v1/admin/review-queue/${id}/resolve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action, value: newValue })
            });
            const data = await response.json();
            if (response.status === 401) {
                alert('Adminsessionen har gått ut. Logga in igen eller förnya token.');
                return;
            }
            if (data.ok) {
                setQueue(prev => prev.filter(item => item.id !== id));
            } else {
                alert('Fel vid hantering: ' + (data.error?.message || 'Okänt fel'));
            }
        } catch {
            alert('Nätverksfel vid inskickning.');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) return <div className="p-10 text-slate-500 font-bold">Laddar granskningsö...</div>;
    if (error) return <div className="p-10 text-red-600 bg-red-50 border border-red-200 rounded-xl">{error}</div>;

    return (
        <div className="space-y-6">
            <header className="flex justify-between items-end">
                <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Systemadministration</p>
                    <h2 className="text-2xl font-black text-slate-900">Kvalitetssäkring av metadata</h2>
                    <p className="text-sm text-slate-500 mt-1">Granska och åtgärda konflikter eller låg tillförlitlighet i extraherad data.</p>
                </div>
                <div className="bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
                    {queue.length} ärenden väntar på granskning
                </div>
            </header>

            {queue.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center">
                    <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-4">
                        <i className="fas fa-check-double text-2xl" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Kön är tom</h3>
                    <p className="text-slate-500 max-w-sm mx-auto mt-2">Alla extraktioner har antingen hög tillförlitlighet eller har redan granskats manuellt.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {queue.map(item => (
                        <div key={item.id} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row gap-6 hover:border-indigo-300 transition-colors">
                            <div className="flex-1 space-y-4">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${item.queueType === 'DISAGREEMENT' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}>
                                        {item.queueType === 'DISAGREEMENT' ? 'Konflikt' : 'Låg tillförlitlighet'}
                                    </span>
                                    <span className="text-xs text-slate-400">Skapad: {new Date(item.createdAt).toLocaleDateString('sv-SE')}</span>
                                </div>

                                <div>
                                    <h4 className="font-bold text-slate-900 text-lg leading-tight">{item.document.subject}</h4>
                                    <p className="text-xs text-slate-500 truncate mt-1">{item.document.absolutePath}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                    <div>
                                        <p className="text-[10px] uppercase font-black text-slate-400 mb-1">Fältnamn</p>
                                        <p className="font-bold text-indigo-600">{item.fieldName}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-black text-slate-400 mb-1">Föreslaget värde</p>
                                        <p className="font-bold">{item.proposedValue || '(Tomt)'}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-[10px] uppercase font-black text-slate-400 mb-1">Orsak</p>
                                        <p className="text-sm text-slate-600">{item.reason}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="md:w-64 flex flex-col justify-center gap-3 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                                <button
                                    onClick={() => handleResolve(item.id, 'APPROVE')}
                                    disabled={busyId === item.id}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50"
                                >
                                    {busyId === item.id ? 'Bearbetar...' : 'Godkänn förslag'}
                                </button>
                                <button
                                    onClick={() => {
                                        const newVal = prompt('Ange rätt värde manuellt:', item.proposedValue || '');
                                        if (newVal !== null) handleResolve(item.id, 'APPROVE', newVal);
                                    }}
                                    disabled={busyId === item.id}
                                    className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50"
                                >
                                    Justera och godkänn
                                </button>
                                <button
                                    onClick={() => handleResolve(item.id, 'REJECT')}
                                    disabled={busyId === item.id}
                                    className="w-full border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 font-bold py-3 rounded-xl transition-all disabled:opacity-50"
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
