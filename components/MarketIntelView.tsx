import React, { useMemo, useState } from 'react';
import StatsOverview from './StatsOverview';
import PermitTable from './PermitTable';
import MapView from './MapView';
import { Permit, Receiver, WasteCode } from '../types';
import { WASTE_CODES } from '../constants';
import { useProjectStructure } from './ProjectStructureContext';

interface MarketIntelViewProps {
  permits: Permit[];
  onSelectPermit: (permit: Permit) => void;
  mode?: 'archive' | 'logistics';
}

const MarketIntelView: React.FC<MarketIntelViewProps> = ({ permits, onSelectPermit, mode = 'archive' }) => {
  const { syncPermitToArchive, addArchiveDocument, markModuleReady, runTransportComplianceFlow, remoteSync } =
    useProjectStructure();
  const receivers: Receiver[] = [];
  const [selectedWasteCode, setSelectedWasteCode] = useState<WasteCode | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Receiver | null>(null);
  const [massAmount, setMassAmount] = useState<number>(0);
  const [driverName, setDriverName] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [origin, setOrigin] = useState('Projektplats');
  const [destination, setDestination] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [syncInfo, setSyncInfo] = useState('');
  const [flowError, setFlowError] = useState('');

  const stats = useMemo(
    () => ({
      total: permits.length,
      bifall: permits.filter((permit) => permit.decision_type === 'BIFALL').length,
      avslag: permits.filter((permit) => permit.decision_type === 'AVSLAG').length,
      municipalities: new Set(permits.map((permit) => permit.municipality)).size,
    }),
    [permits]
  );

  const handleSyncArchive = () => {
    permits.forEach((permit) => syncPermitToArchive(permit));
    markModuleReady('LOGISTICS_MARKET', `Archive handoff active (${permits.length} permit snapshots).`);
    setSyncInfo(`Synkade ${permits.length} beslut till projektarkivet.`);
  };

  const handleBookTransport = async () => {
    setFlowError('');
    setSyncInfo('');

    if (!selectedWasteCode || !selectedReceiver) {
      setFlowError('Valj avfallskod och mottagare innan bokning.');
      return;
    }
    if (massAmount <= 0) {
      setFlowError('Mangd maste vara storre an 0 ton.');
      return;
    }
    if (!driverName.trim() || !vehicleId.trim() || !reviewerName.trim()) {
      setFlowError('Forare, fordon och granskare ar obligatoriska for human-in-the-loop.');
      return;
    }

    setIsBooking(true);
    try {
      const result = await runTransportComplianceFlow({
        receiverId: selectedReceiver.id,
        receiverName: selectedReceiver.name,
        wasteCode: selectedWasteCode.code,
        tons: Math.max(0.1, massAmount),
        distanceKm: 12.5,
        driverName: driverName.trim(),
        vehicleId: vehicleId.trim(),
        reviewerName: reviewerName.trim(),
        origin: origin.trim() || 'Projektplats',
        destination: destination.trim() || selectedReceiver.name,
      });

      const transportDocumentName = `Transportdokument-${result.bookingId}`;
      const weighTicketName = `Vagkort-${result.bookingId}`;

      addArchiveDocument({
        name: transportDocumentName,
        module: 'LOGISTICS_MARKET',
        category: 'FIELD',
        status: result.documentGate === 'PASSED' ? 'VERIFIED' : 'DRAFT',
        tags: [
          'transportdokument',
          'chaufforsflode',
          selectedWasteCode.code.toLowerCase(),
          result.preliminary ? 'preliminar' : 'verified',
        ],
      });

      addArchiveDocument({
        name: weighTicketName,
        module: 'LOGISTICS_MARKET',
        category: 'FIELD',
        status: result.documentGate === 'PASSED' ? 'VERIFIED' : 'DRAFT',
        tags: [
          'vagkort',
          'chaufforsflode',
          selectedWasteCode.code.toLowerCase(),
          result.preliminary ? 'preliminar' : 'verified',
        ],
      });

      addArchiveDocument({
        name: `Transportkedja-${selectedReceiver.name}-${selectedWasteCode.code}`,
        module: 'LOGISTICS_MARKET',
        category: 'FIELD',
        status: result.documentGate === 'PASSED' ? 'VERIFIED' : 'DRAFT',
        tags: [
          'transport',
          selectedWasteCode.code.toLowerCase(),
          selectedReceiver.name.toLowerCase(),
          result.preliminary ? 'preliminar' : 'verified',
        ],
      });

      markModuleReady(
        'LOGISTICS_MARKET',
        `1-klicksflode klart (${result.bookingId}). Carbon: ${result.carbonGate}, Document: ${result.documentGate}.`
      );

      const limsInfo = result.limsReportId ? ` LIMS: ${result.limsReportId}.` : '';
      const preliminaryInfo = result.preliminary
        ? ' Preliminart lage: signatur- och LIMS-spar ar lokala tills extern verifiering finns.'
        : '';
      setSyncInfo(
        `Transportkedja skapad. Booking: ${result.bookingId}. Carbon gate: ${result.carbonGate}. Document gate: ${result.documentGate}. Transportdokument: ${transportDocumentName}. Vagkort: ${weighTicketName}.${limsInfo}${preliminaryInfo}`
      );
    } catch (error: unknown) {
      setFlowError(error instanceof Error ? error.message : 'Kunde inte slutföra transportflodet.');
    } finally {
      setIsBooking(false);
    }
  };

  if (mode === 'logistics') {
    const isCompatible = Boolean(selectedReceiver && selectedWasteCode && selectedReceiver.allowedCodes.includes(selectedWasteCode.code));
    const distanceKm = 12.5;
    const co2Estimate = massAmount * distanceKm * 0.12;

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Logistik och schaktmassor</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Planera mottagare, transport och klimatpaverkan</h2>
          <p className="mt-3 max-w-3xl text-sm text-slate-600">
            Matcha avfallskod mot tillatna mottagare och skapa dokumenterad transportkedja med compliance-kontroll.
          </p>
          {!remoteSync.enabled && (
            <p className="mt-3 text-xs font-semibold text-amber-700">
              Transportflodet ar blockerat tills adminsession, projektkoppling och riktig dispatch-provider ar konfigurerade.
            </p>
          )}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.7fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Steg 1</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">Mass-matchning</h3>

              <div className="mt-4 space-y-4">
                {receivers.length === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Verifierad mottagarkatalog saknas. Transportbokning ar darfor blockerad tills riktiga mottagare och tillstand finns
                    inkopplade.
                  </div>
                )}
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Avfallskod (EWC)</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
                    onChange={(event) => setSelectedWasteCode(WASTE_CODES.find((code) => code.code === event.target.value) || null)}
                    value={selectedWasteCode?.code || ''}
                  >
                    <option value="">Valj kod</option>
                    {WASTE_CODES.filter((code) => code.type === 'EWC').map((code) => (
                      <option key={code.code} value={code.code}>
                        {code.code} - {code.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Mangd (ton)</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
                    placeholder="Exempel: 500"
                    value={massAmount || ''}
                    onChange={(event) => setMassAmount(Number(event.target.value || 0))}
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Mottagare (snabbval)</span>
                  <select
                    disabled={receivers.length === 0}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
                    value={selectedReceiver?.id || ''}
                    onChange={(event) =>
                      setSelectedReceiver(receivers.find((receiver) => receiver.id === event.target.value) || null)
                    }
                  >
                    <option value="">{receivers.length === 0 ? 'Ingen verifierad mottagare' : 'Valj mottagare'}</option>
                    {receivers.map((receiver) => (
                      <option key={receiver.id} value={receiver.id}>
                        {receiver.name} ({receiver.type})
                      </option>
                    ))}
                  </select>
                </label>

                {selectedWasteCode && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-blue-700 font-black">Aktivt krav</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{selectedWasteCode.requirements.storageTime || 'Ej specificerat'}</p>
                  </div>
                )}
              </div>
            </div>

            {selectedReceiver && (
              <div className={`rounded-3xl border p-6 shadow-sm ${isCompatible ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-white ${
                      isCompatible ? 'bg-emerald-600' : 'bg-rose-600'
                    }`}
                  >
                    <i className={`fas ${isCompatible ? 'fa-check' : 'fa-triangle-exclamation'}`} />
                  </span>
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-[0.18em] font-black text-slate-600">Steg 2</p>
                    <h4 className="text-lg font-black text-slate-900">{isCompatible ? 'Matchning godkand' : 'Ej tillatet'}</h4>
                    <p className="mt-1 text-sm text-slate-700">
                      {isCompatible
                        ? `${selectedReceiver.name} kan ta emot vald kod.`
                        : `${selectedReceiver.name} saknar tillstand for vald kod.`}
                    </p>
                  </div>
                </div>

                {isCompatible && (
                  <div className="mt-4 space-y-2 rounded-xl bg-white/70 p-3 text-sm">
                    <div className="flex justify-between"><span>Distans</span><span className="font-bold">{distanceKm} km</span></div>
                    <div className="flex justify-between"><span>CO2-estimat</span><span className="font-bold">{co2Estimate.toFixed(1)} kg</span></div>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-black">Forare (obligatoriskt)</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        placeholder="Namn pa forare"
                        value={driverName}
                        onChange={(event) => setDriverName(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-black">Fordon (obligatoriskt)</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        placeholder="Registreringsnummer"
                        value={vehicleId}
                        onChange={(event) => setVehicleId(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-black">Granskare (obligatoriskt)</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        placeholder="Namn pa ansvarig granskare"
                        value={reviewerName}
                        onChange={(event) => setReviewerName(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-black">Ursprung</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        placeholder="Projektplats"
                        value={origin}
                        onChange={(event) => setOrigin(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-black">Destination</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        placeholder={selectedReceiver.name}
                        value={destination}
                        onChange={(event) => setDestination(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        void handleBookTransport();
                      }}
                      disabled={isBooking}
                      className="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white disabled:opacity-60"
                    >
                      {isBooking ? 'Korer transportflode...' : 'Boka transport'}
                    </button>
                    {flowError && <p className="mt-2 text-xs font-semibold text-rose-700">{flowError}</p>}
                    {syncInfo && <p className="mt-2 text-xs font-semibold text-emerald-700">{syncInfo}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Steg 3</p>
              <h3 className="text-lg font-black text-slate-900">Interaktiv mottagarkarta</h3>
            </div>
            <div className="h-[520px]">
              <MapView receivers={receivers} onSelectReceiver={setSelectedReceiver} selectedReceiverId={selectedReceiver?.id} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Data och KPI</p>
        <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Beslutsarkiv for logistik och regelefterlevnad</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Folj nyckeltal for masshantering, klassning och spårbarhet enligt kravbilden i Avfallsforordningen.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSyncArchive}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white"
          >
            Synka till projektplan
          </button>
          {syncInfo && <p className="text-xs text-slate-600">{syncInfo}</p>}
        </div>
      </section>

      <StatsOverview stats={stats} />

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Compliance-check</p>
          <h3 className="mt-2 text-lg font-black text-white">Logistikkrav fore transport och mottagning</h3>
          <div className="mt-5 space-y-2 text-sm text-slate-200">
            <p>Validera att vald mottagare har tillstand for avfallskod och fororeningsklass.</p>
            <p>Blockera bokning nar klassning och mottagarlicens inte matchar.</p>
            <p>Sakerstall sparbarhet: mangd, ursprung, mottagare och transportdatum.</p>
            <p>Styr till korrekt deponi eller behandling nar riktvarden for anlaggningsandamal overskrids.</p>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Kartlager</p>
          <h3 className="mt-2 text-lg font-black text-white">GIS-stod for mottagning och deponi</h3>
          <div className="mt-5 h-[340px] overflow-hidden rounded-2xl border border-slate-700">
            <MapView permits={permits} onSelectPermit={onSelectPermit} />
          </div>
        </div>
      </section>

      <PermitTable permits={permits} onSelect={onSelectPermit} />
    </div>
  );
};

export default MarketIntelView;
