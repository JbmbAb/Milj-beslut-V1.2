import React, { useState } from 'react';
import type { Permit } from '../types';

export default function GeminiClientExample({ permit }: { permit: Permit }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'analyzePermitRisk', payload: { permit } }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else {
        setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2));
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 6 }}>
      <h4>Gemini: Analysera tillstånd</h4>
      <div style={{ marginBottom: 8 }}>
        <strong>Fastighet:</strong> {permit.property_id} — <strong>Kommun:</strong> {permit.municipality}
      </div>
      <button onClick={analyze} disabled={loading}>
        {loading ? 'Analyserar…' : 'Kör analys'}
      </button>

      {error && <pre style={{ color: 'crimson', marginTop: 8 }}>{error}</pre>}
      {result && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{result}</pre>}
    </div>
  );
}
