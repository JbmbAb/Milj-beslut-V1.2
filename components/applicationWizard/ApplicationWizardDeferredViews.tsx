import React from 'react';

type SummaryCardModel = {
  title: string;
  tone: 'ok' | 'warn' | 'critical' | 'manual';
  status: string;
  description: string;
};

type SourceRef = { web?: { title: string; uri: string } };

type AuditBundle = {
  lat: number;
  lng: number;
  spatial: any | null;
  climate: any | null;
  heritage: any | null;
  water: any | null;
  issues: string[];
};

const toneClassMap: Record<SummaryCardModel['tone'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  manual: 'border-slate-200 bg-slate-50 text-slate-800',
};

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <span className="font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function AuditScope({ title, icon, description }: { title: string; icon: string; description: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <i className={`fas ${icon}`} />
        </div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">{title}</p>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

const SummaryCard: React.FC<{ card: SummaryCardModel }> = ({ card }) => {
  return (
    <article className={`rounded-3xl border p-6 ${toneClassMap[card.tone]}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.14em]">{card.title}</p>
      <p className="mt-3 text-xl font-black">{card.status}</p>
      <p className="mt-3 text-sm leading-7">{card.description}</p>
    </article>
  );
};

interface LocationAuditStepProps {
  identityStatus: string;
  latInput: string;
  lngInput: string;
  coordinatesValid: boolean;
  onLatChange: (value: string) => void;
  onLngChange: (value: string) => void;
  onBack: () => void;
  onRunAudit: () => void;
}

export const LocationAuditStep: React.FC<LocationAuditStepProps> = ({
  identityStatus,
  latInput,
  lngInput,
  coordinatesValid,
  onLatChange,
  onLngChange,
  onBack,
  onRunAudit,
}) => (
  <section className="min-h-[560px] space-y-8 p-10 md:p-16">
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h3 className="text-3xl font-black tracking-tight text-slate-900">Plats och auditkorning</h3>
        <p className="mt-2 text-sm text-slate-600">
          Ange koordinater och kor verkliga publika audits. Resultatet ar beslutsstod och maste alltid
          granskas manuellt.
        </p>
      </div>
      <div className="rounded-full bg-slate-100 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700">
        Identitet: {identityStatus}
      </div>
    </div>

    <div className="grid gap-6 md:grid-cols-2">
      <label className="space-y-2">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Latitud</span>
        <input
          value={latInput}
          onChange={(event) => onLatChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
          placeholder="59.3293"
        />
      </label>
      <label className="space-y-2">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Longitud</span>
        <input
          value={lngInput}
          onChange={(event) => onLngChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500"
          placeholder="18.0686"
        />
      </label>
    </div>

    <div className="flex flex-wrap gap-3">
      {!coordinatesValid && (
        <span className="rounded-full bg-amber-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">
          Ange verifierade koordinater
        </span>
      )}
    </div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AuditScope
        title="Skyddad natur"
        icon="fa-shield-halved"
        description="NVR och Natura 2000 mot lokal PostGIS eller verifierad livekälla."
      />
      <AuditScope
        title="SGU georisk"
        icon="fa-mountain"
        description="Grundlager och jordskred-raviner vags in som indikativ risk."
      />
      <AuditScope
        title="Vatten"
        icon="fa-water"
        description="Hydrologiskt auditpaket mot lokala lager. Saknas lokal tabell kravs manuell kontroll eller riktig VISS-behorighet."
      />
      <AuditScope
        title="Kulturmiljo och klimat"
        icon="fa-landmark"
        description="RAA och MSB korning utan att skapa automatisk beslutseffekt."
      />
    </div>

    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <i className="fas fa-triangle-exclamation mt-0.5 text-amber-600" />
        <div>
          <p className="font-black uppercase tracking-[0.14em]">Human in the loop</p>
          <p className="mt-2">
            Korningen genererar beslutsstod. Slutlig bedomning, avgransning och eventuell inskickning gor
            manniska efter manuell granskning.
          </p>
        </div>
      </div>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <button
        type="button"
        onClick={onBack}
        className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700"
      >
        Tillbaka
      </button>
      <button
        type="button"
        onClick={onRunAudit}
        disabled={!coordinatesValid}
        className="rounded-2xl bg-emerald-600 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Kor full audit
      </button>
    </div>
  </section>
);

interface RiskSummaryStepProps {
  auditBundle: AuditBundle;
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  overallRiskLabel: string;
  summaryCards: SummaryCardModel[];
  manualReviewRequired: boolean;
  sources: SourceRef[];
  onChangeCoordinates: () => void;
  onContinue: () => void;
}

export const RiskSummaryStep: React.FC<RiskSummaryStepProps> = ({
  auditBundle,
  overallRisk,
  overallRiskLabel,
  summaryCards,
  manualReviewRequired,
  sources,
  onChangeCoordinates,
  onContinue,
}) => (
  <section className="min-h-[560px] space-y-8 p-10 md:p-16">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h3 className="text-3xl font-black tracking-tight text-slate-900">Samlad riskbild</h3>
        <p className="mt-2 text-sm text-slate-600">
          Sammanstallningen bygger pa verkliga auditsvar. Negativa resultat utan full tackning maste tolkas
          forsiktigt och granskas manuellt.
        </p>
      </div>
      <div
        className={`rounded-3xl px-5 py-4 text-center ${
          overallRisk === 'HIGH'
            ? 'bg-rose-50 text-rose-700'
            : overallRisk === 'MEDIUM'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-emerald-50 text-emerald-700'
        }`}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.14em]">Samlad risk</p>
        <p className="mt-1 text-2xl font-black">{overallRiskLabel}</p>
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {summaryCards.map((card) => (
        <SummaryCard key={card.title} card={card} />
      ))}
    </div>

    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
        Narrativ sammanfattning
      </p>
      <p className="mt-3 text-sm leading-7 text-slate-700">
        {auditBundle.spatial?.text || 'Ingen spatial narrativ sammanfattning tillganglig.'}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StatusRow
          label="Koordinater"
          value={`${auditBundle.lat.toFixed(6)}, ${auditBundle.lng.toFixed(6)}`}
        />
        <StatusRow
          label="Manuell grind"
          value={manualReviewRequired ? 'Kravs' : 'Kan fortfarande rekommenderas'}
        />
      </div>
    </div>

    {auditBundle.issues.length > 0 && (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">
          Delvisa fel eller saknade verifierade källor
        </p>
        <ul className="mt-3 space-y-2 text-sm text-amber-800">
          {auditBundle.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-2">
              <i className="fas fa-circle-exclamation mt-1 text-xs" />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      </div>
    )}

    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Kallor</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {sources.length > 0 ? (
          sources.map((source) => (
            <a
              key={source.web?.uri}
              href={source.web?.uri}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-slate-300 px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-700"
            >
              {source.web?.title || source.web?.uri}
            </a>
          ))
        ) : (
          <span className="text-sm text-slate-500">Inga explicita kallor returnerades i auditpaketet.</span>
        )}
      </div>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <button
        type="button"
        onClick={onChangeCoordinates}
        className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700"
      >
        Andra koordinater
      </button>
      <button
        type="button"
        onClick={onContinue}
        className="rounded-2xl bg-slate-900 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-white"
      >
        Ga till manuell grind
      </button>
    </div>
  </section>
);

interface ManualGateStepProps {
  auditBundle: AuditBundle;
  identityStatus: string;
  overallRiskLabel: string;
  manualReviewRequired: boolean;
  onBack: () => void;
  onReset: () => void;
}

export const ManualGateStep: React.FC<ManualGateStepProps> = ({
  auditBundle,
  identityStatus,
  overallRiskLabel,
  manualReviewRequired,
  onBack,
  onReset,
}) => {
  const [archiving, setArchiving] = React.useState(false);
  const [archiveId, setArchiveId] = React.useState<string | null>(null);

  const archiveResult = async () => {
    setArchiving(true);
    try {
      const response = await fetch('/api/audit/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: auditBundle.lat,
          lng: auditBundle.lng,
          overallRisk: overallRiskLabel,
          identityStatus,
          auditBundle,
        }),
      });
      const data = await response.json();
      if (data.ok) setArchiveId(data.id);
    } catch (e) {
      console.error('Archive failed', e);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <section className="min-h-[560px] space-y-8 p-10 md:p-16">
      <div>
        <h3 className="text-3xl font-black tracking-tight text-slate-900">Manuell grind och ansvar</h3>
        <p className="mt-2 text-sm text-slate-600">
          Detta steg ersatter automatisk signering. Beslutsstodet far inte behandlas som slutligt utan manuell
          verifiering, dokumentbedomning och juridisk kontroll.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Granskningskort</p>
          <div className="mt-4 space-y-3">
            <StatusRow label="Identitet" value={identityStatus} />
            <StatusRow
              label="Koordinater"
              value={`${auditBundle.lat.toFixed(6)}, ${auditBundle.lng.toFixed(6)}`}
            />
            <StatusRow label="Samlad risk" value={overallRiskLabel} />
            <StatusRow
              label="Skyddad natur"
              value={
                auditBundle.spatial?.isProtected
                  ? 'Traff'
                  : auditBundle.spatial?.protectedAreaAvailable
                    ? 'Ingen traff'
                    : 'Ej verifierat'
              }
            />
            <StatusRow
              label="Manuell granskning"
              value={manualReviewRequired ? 'Obligatorisk' : 'Fortfarande rekommenderad'}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">Bindande regel</p>
          <p className="mt-3">
            Ingen automatisk ansokan, inget slutligt ja/nej och ingen juridisk slutsats far produceras utan
            manniska i loopen. Resultat med stickprov, saknade verifierade kallor eller oklara kallor ska
            eskaleras till manuell granskning.
          </p>
          <ul className="mt-4 space-y-2">
            <li>Verifiera platsen mot primarkallor om risknivan ar medel eller hog.</li>
            <li>Bekrafta att skyddad natur och georisk ar rimligt tolkade i aktuell skala.</li>
            <li>Dokumentera granskaren innan materialet anvands vidare.</li>
          </ul>
        </div>
      </div>

      {archiveId ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <div className="flex items-center gap-3">
            <i className="fas fa-circle-check text-xl" />
            <p className="font-black uppercase tracking-widest">Granskning arkiverad!</p>
          </div>
          <p className="mt-2 text-sm">
            Referens-ID: <code className="font-mono">{archiveId}</code>. Dokumentet finns nu i beslutsarkivet.
          </p>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Slutsteg</p>
          <p className="mt-3 text-sm text-slate-700">
            Det har steget stoppar medvetet fore inskickning. Granskaren maste nu ta over, lasa underlagen och
            fatta beslut om fortsatt handlaggning.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={archiving || !!archiveId}
          className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700 disabled:opacity-30"
        >
          Tillbaka till auditsvar
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onReset}
            className="rounded-2xl border border-slate-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-slate-700"
          >
            Ny korning
          </button>
          {!archiveId && (
            <button
              type="button"
              onClick={archiveResult}
              disabled={archiving}
              className="rounded-2xl bg-emerald-600 px-8 py-4 text-xs font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-emerald-200 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {archiving ? 'Arkiverar...' : 'Slutfor och Arkivera'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
