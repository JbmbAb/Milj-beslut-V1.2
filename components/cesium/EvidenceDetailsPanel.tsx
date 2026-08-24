import React from 'react';
import { admitLayerIdForLogical } from './layerIdMapping';
import type { CesiumEvidenceMode } from './types';

export type EvidenceObservationProps = {
  title?: string;
  description?: string;
  color?: string;
  provider?: string;
  dataset?: string;
  layer_id?: string;
  layer_version?: string;
  retrieved_at?: string;
  evidence_id?: string;
  cas_artifact_id?: string;
  cas_content_hash?: string;
  registry_artifact_id?: string;
  registry_content_hash?: string;
  approval_artifact_id?: string;
  approval_role?: string;
  governance_status?: string;
  admit_layer_id?: string;
};

type EvidenceDetailsPanelProps = {
  evidence: EvidenceObservationProps;
  evidenceMode: CesiumEvidenceMode;
  onClose: () => void;
};

const EvidenceDetailsPanel: React.FC<EvidenceDetailsPanelProps> = ({
  evidence,
  evidenceMode,
  onClose,
}) => {
  const admitId = evidence.admit_layer_id || admitLayerIdForLogical(evidence.layer_id);
  const accent = evidence.color || '#38bdf8';
  const statusLabel =
    evidence.governance_status || (evidenceMode === 'fixture' ? 'FIXTURE_OBSERVATION' : 'VERIFIED_OBSERVATION');
  const statusTone =
    evidenceMode === 'fixture'
      ? 'bg-amber-500/20 text-amber-200 border-amber-500/30'
      : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30';

  const retrievedLabel = evidence.retrieved_at
    ? (() => {
        try {
          return new Date(evidence.retrieved_at).toLocaleString('sv-SE');
        } catch {
          return evidence.retrieved_at;
        }
      })()
    : '—';

  return (
    <div className="absolute bottom-6 left-6 right-6 z-[1000] bg-slate-950/95 text-white p-5 md:p-6 rounded-[2rem] border border-slate-800 shadow-2xl flex flex-col gap-4 backdrop-blur-lg">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className="h-10 w-10 rounded-2xl flex items-center justify-center font-bold text-lg shrink-0"
            style={{ backgroundColor: `${accent}33`, color: accent }}
          >
            <i className="fas fa-fingerprint" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="font-black text-sm uppercase tracking-wider text-slate-200">
                {evidence.title || 'Evidens'}
              </h5>
              <span
                className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase border ${statusTone}`}
              >
                {statusLabel}
              </span>
              {evidence.layer_id && (
                <span className="text-[9px] font-mono font-bold bg-white/10 px-2 py-0.5 rounded-full text-cyan-200">
                  layer_id: {evidence.layer_id}
                </span>
              )}
              {admitId && (
                <span className="text-[9px] font-mono font-bold bg-white/5 px-2 py-0.5 rounded-full text-slate-400">
                  admit: {admitId}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">{evidence.description || 'Observation utan beskrivning.'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span>
                Källa: <b className="text-slate-300">{evidence.provider || '—'}</b>
              </span>
              <span>
                Dataset:{' '}
                <b className="text-slate-300">
                  {evidence.dataset || '—'}
                  {evidence.layer_version ? ` (${evidence.layer_version})` : ''}
                </b>
              </span>
              <span>
                Extraherat: <b className="text-slate-300">{retrievedLabel}</b>
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-black uppercase text-slate-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl shrink-0"
        >
          Stäng
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-slate-800 pt-3">
        <div className="rounded-xl bg-black/30 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-0.5">
            Artifact ID
          </div>
          <div className="text-[10px] font-mono text-slate-200 break-all select-all">
            {evidence.evidence_id || evidence.cas_artifact_id || '—'}
          </div>
        </div>
        <div className="rounded-xl bg-black/30 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-0.5">
            CAS content hash
          </div>
          <div className="text-[10px] font-mono text-slate-200 break-all select-all">
            {evidence.cas_content_hash || '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <ProvenanceCell label="Registry artifact" value={evidence.registry_artifact_id || '—'} />
        <ProvenanceCell label="Registry hash" value={evidence.registry_content_hash || '—'} />
        <ProvenanceCell
          label="Approval"
          value={
            evidence.approval_artifact_id
              ? `${evidence.approval_artifact_id}${evidence.approval_role ? ` · ${evidence.approval_role}` : ''}`
              : '—'
          }
        />
      </div>
    </div>
  );
};

const ProvenanceCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl bg-black/20 px-3 py-2">
    <div className="mb-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
      {label}
    </div>
    <div className="break-all font-mono text-[10px] text-slate-300 select-all">{value}</div>
  </div>
);

export default EvidenceDetailsPanel;
