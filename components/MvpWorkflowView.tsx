import React, { useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────
type StepStatus = 'idle' | 'loading' | 'done' | 'error';
type FlowStep = {
    id: number;
    label: string;
    endpoint: string;
    status: StepStatus;
    result: any;
};

const TOKEN_KEY = 'miljobeslut_admin_bearer';
function getToken() { return String(window.localStorage.getItem(TOKEN_KEY) || '').trim(); }

async function callMvp<T>(endpoint: string, body: object): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.headers.get('content-type')?.includes('application/json')) return res.json() as Promise<T>;
    return res.text() as unknown as Promise<T>;
}

// ─── Card ──────────────────────────────────────────────────────────────────
const StepCard: React.FC<{ step: FlowStep }> = ({ step }) => {
    const statusColor =
        step.status === 'done' ? 'border-emerald-500 bg-emerald-950/30'
            : step.status === 'error' ? 'border-red-500 bg-red-950/30'
                : step.status === 'loading' ? 'border-amber-500 bg-amber-950/20'
                    : 'border-slate-700 bg-slate-900/40';

    const icon =
        step.status === 'done' ? '✅'
            : step.status === 'error' ? '❌'
                : step.status === 'loading' ? '⏳'
                    : '○';

    return (
        <div className={`rounded-2xl border p-4 transition-all duration-300 ${statusColor}`}>
            <div className="flex items-center gap-3 mb-2">
                <span className="text-xl">{icon}</span>
                <div>
                    <p className="font-bold text-white text-sm">{step.id}. {step.label}</p>
                    <p className="text-xs text-slate-400 font-mono">{step.endpoint}</p>
                </div>
            </div>
            {step.result && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-emerald-300 whitespace-pre-wrap">
                    {typeof step.result === 'string' ? step.result.substring(0, 600) : JSON.stringify(step.result, null, 2).substring(0, 600)}
                </pre>
            )}
        </div>
    );
};

// ─── Main View ─────────────────────────────────────────────────────────────
const MvpWorkflowView: React.FC = () => {
    const [ewcCode, setEwcCode] = useState('17 05 04');
    const [activityCode, setActivityCode] = useState('29.40');
    const [volumeTons, setVolumeTons] = useState('500');
    const [location, setLocation] = useState('Göteborg');
    const [municipality, setMunicipality] = useState('Göteborg');
    const [running, setRunning] = useState(false);
    const [exportText, setExportText] = useState('');

    const initialSteps: FlowStep[] = [
        { id: 1, label: 'Klassifiera verksamhet', endpoint: '/api/v1/classification/activity', status: 'idle', result: null },
        { id: 2, label: 'Hämta juridiska krav', endpoint: '/api/v1/compliance/requirements', status: 'idle', result: null },
        { id: 3, label: 'Riskanalys', endpoint: '/api/v1/compliance/risk-analysis', status: 'idle', result: null },
        { id: 4, label: 'Labbdatavalidering', endpoint: '/api/v1/lab/validate', status: 'idle', result: null },
        { id: 5, label: 'Generera ansökningsutkast', endpoint: '/api/v1/permit/generate', status: 'idle', result: null },
        { id: 6, label: 'Verifiera juridiska citat', endpoint: '/api/v1/verification/check', status: 'idle', result: null },
        { id: 7, label: 'Exportera dokument', endpoint: '/api/v1/document/export', status: 'idle', result: null },
    ];
    const [steps, setSteps] = useState<FlowStep[]>(initialSteps);

    const setStepState = (id: number, patch: Partial<FlowStep>) =>
        setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

    const runWorkflow = async () => {
        setRunning(true);
        setExportText('');
        setSteps(initialSteps);

        try {
            // Step 1: Classification
            setStepState(1, { status: 'loading' });
            const cls = await callMvp<any>('/api/v1/classification/activity', {
                activity_code: activityCode, ewc_code: ewcCode, volume_tons: Number(volumeTons)
            });
            setStepState(1, { status: 'done', result: cls });

            // Step 2: Requirements
            setStepState(2, { status: 'loading' });
            const req = await callMvp<any>('/api/v1/compliance/requirements', {
                activity_code: activityCode, ewc_code: ewcCode
            });
            setStepState(2, { status: 'done', result: req });

            // Step 3: Risk analysis
            setStepState(3, { status: 'loading' });
            const risk = await callMvp<any>('/api/v1/compliance/risk-analysis', {
                ewc_code: ewcCode, volume_tons: volumeTons, location
            });
            setStepState(3, { status: 'done', result: risk });

            // Step 4: Lab validate (mock sample)
            setStepState(4, { status: 'loading' });
            const lab = await callMvp<any>('/api/v1/lab/validate', {
                sample_results: [
                    { parameter: 'Arsenik', value: 12, unit: 'mg/kg TS' },
                    { parameter: 'Bly', value: 55, unit: 'mg/kg TS' },
                    { parameter: 'PAH (16)', value: 3.2, unit: 'mg/kg TS' },
                ]
            });
            setStepState(4, { status: 'done', result: lab });

            // Step 5: Permit generate
            setStepState(5, { status: 'loading' });
            const permit = await callMvp<any>('/api/v1/permit/generate', {
                project_data: {
                    name: `Projekt ${location} ${ewcCode}`,
                    ewc_code: ewcCode,
                    volume_tons: Number(volumeTons),
                    municipality,
                    property_id: 'okänd fastighet'
                },
                requirements: req.requirements,
                risk_flags: risk.risk_flags
            });
            setStepState(5, { status: 'done', result: { document_type: permit.document_type, draft_preview: permit.draft_text?.substring(0, 200) + '...' } });

            // Step 6: Verify citations
            setStepState(6, { status: 'loading' });
            const verif = await callMvp<any>('/api/v1/verification/check', { analysis: req });
            setStepState(6, { status: 'done', result: verif });

            // Step 7: Export document
            setStepState(7, { status: 'loading' });
            const exported = await callMvp<string>('/api/v1/document/export', {
                draft_text: permit.draft_text,
                document_type: permit.document_type
            });
            setExportText(exported);
            setStepState(7, { status: 'done', result: `Dokument exporterat (${String(exported).length} tecken)` });

        } catch (e: any) {
            const failId = steps.find(s => s.status === 'loading')?.id ?? 1;
            setStepState(failId, { status: 'error', result: e.message });
        } finally {
            setRunning(false);
        }
    };

    const downloadExport = () => {
        if (!exportText) return;
        const blob = new Blob([exportText], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'C-anmalan.txt'; a.click();
        URL.revokeObjectURL(url);
    };

    const allDone = steps.every(s => s.status === 'done');
    const hasError = steps.some(s => s.status === 'error');

    return (
        <div className="min-h-screen bg-slate-950 text-white p-6 font-['Plus_Jakarta_Sans']">
            <div className="mx-auto max-w-5xl">

                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-black bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                        MVP – Ansökningsflöde
                    </h1>
                    <p className="text-slate-400 mt-1">
                        Från EWC-kod och volym till färdig C-anmälan i ett klick.
                    </p>
                </div>

                {/* Input form */}
                <div className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/50 p-6">
                    <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">Projektdata</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {[
                            { label: 'EWC-kod', value: ewcCode, set: setEwcCode, placeholder: '17 05 04' },
                            { label: 'Aktivitetskod (MPF)', value: activityCode, set: setActivityCode, placeholder: '29.40' },
                            { label: 'Volym (ton)', value: volumeTons, set: setVolumeTons, placeholder: '500' },
                            { label: 'Plats/Adress', value: location, set: setLocation, placeholder: 'Göteborg' },
                            { label: 'Kommun', value: municipality, set: setMunicipality, placeholder: 'Göteborg' },
                        ].map(({ label, value, set, placeholder }) => (
                            <label key={label} className="flex flex-col gap-1">
                                <span className="text-xs text-slate-400 font-semibold">{label}</span>
                                <input
                                    type="text"
                                    value={value}
                                    onChange={e => set(e.target.value)}
                                    placeholder={placeholder}
                                    className="rounded-xl bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                                />
                            </label>
                        ))}
                    </div>

                    <button
                        onClick={runWorkflow}
                        disabled={running}
                        className="mt-6 w-full rounded-xl py-3 px-6 font-black text-white text-base transition-all duration-200 disabled:opacity-50"
                        style={{ background: running ? '#334155' : 'linear-gradient(135deg, #059669, #0891b2)' }}
                    >
                        {running ? '⏳ Kör flödet...' : '▶ Starta komplett ansökningsflöde'}
                    </button>
                </div>

                {/* Steps */}
                <div className="grid gap-3">
                    {steps.map(step => <StepCard key={step.id} step={step} />)}
                </div>

                {/* Success / Export */}
                {allDone && (
                    <div className="mt-6 rounded-2xl border border-emerald-500 bg-emerald-950/30 p-6 text-center">
                        <p className="text-2xl font-black text-emerald-400 mb-2">🎉 Ansökan klar!</p>
                        <p className="text-slate-300 mb-4">
                            En C-anmälan har genererats och verifierats. Ladda ned för att skicka till kommunen.
                        </p>
                        <button
                            onClick={downloadExport}
                            className="rounded-xl px-6 py-3 font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition"
                        >
                            ⬇ Ladda ned C-anmälan (.txt)
                        </button>
                    </div>
                )}

                {hasError && (
                    <div className="mt-6 rounded-2xl border border-red-500 bg-red-950/30 p-4 text-center">
                        <p className="text-red-400 font-bold">Ett steg misslyckades. Kontrollera autentiseringen och servern.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MvpWorkflowView;
