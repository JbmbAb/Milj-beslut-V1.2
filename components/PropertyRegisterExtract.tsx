import React from 'react';

interface PropertyRegisterExtractProps {
  propertyId: string;
}

const PropertyRegisterExtract: React.FC<PropertyRegisterExtractProps> = ({ propertyId }) => {
  if (!propertyId.trim()) {
    return (
      <div className="mx-auto my-6 max-w-4xl rounded-[2rem] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Fastighetsutdrag</p>
        <h2 className="mt-2 text-xl font-black text-slate-900">Ingen verifierad fastighet vald</h2>
        <p className="mt-3 text-sm">
          Simulerat fallback-utdrag ar borttaget. Valj en riktig fastighet med verifierad datakalla innan registerutdrag visas.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto my-6 max-w-4xl rounded-[2rem] border border-amber-200 bg-amber-50 p-10 text-slate-700">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">Fastighetsutdrag</p>
      <h2 className="mt-2 text-xl font-black text-slate-900">Live-utdrag ej aktiverat</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Vald fastighet ar <span className="font-black">{propertyId}</span>, men denna vy ar avstangd tills ett riktigt
        Lantmateriet-baserat registerutdrag ar kopplat via verifierad backendroute. Mockad registerdata visas inte langre.
      </p>
      <div className="mt-6 rounded-2xl border border-amber-300 bg-white px-5 py-4 text-sm">
        <p className="font-black text-slate-900">Vad som kravs for att visa utdrag har</p>
        <ul className="mt-2 list-disc pl-5 text-slate-600">
          <li>Verifierad live-route for fastighetsutdrag</li>
          <li>Sparbar kallhanvisning till riktig registerdata</li>
          <li>Human-in-the-loop innan utdrag anvands som beslutunderlag</li>
        </ul>
      </div>
    </div>
  );
};

export default PropertyRegisterExtract;
