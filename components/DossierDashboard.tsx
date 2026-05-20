import React from 'react';

// Denna komponent bygger på AI-designen från Stitch och Figma.
// TODO (Copilot Agent): Koppla ihop dessa hårdkodade värden med `DossierBuilder` och Vertex AI-svaret.
export const DossierDashboard: React.FC = () => {
    return (
        <div className="flex min-h-screen font-sans bg-[#f8f9fa] text-[#191c1d]">
            {/* SideNavBar Shell */}
            <aside className="h-screen w-72 fixed left-0 top-0 z-40 bg-white/70 backdrop-blur-2xl flex flex-col py-8 gap-4 shadow-[0_20px_40px_rgba(25,28,29,0.05)]">
                <div className="px-8 mb-8">
                    <h1 className="text-[#0f5238] font-black text-xl tracking-tighter">Miljöbeslut.se</h1>
                    <p className="font-sans text-[10px] font-medium uppercase tracking-widest text-[#191c1d] opacity-50 mt-1">Official Portal</p>
                </div>
                <nav className="flex-1 px-4 space-y-1">
                    <a className="flex items-center gap-4 px-4 py-3 bg-gradient-to-br from-[#0f5238] to-[#1b5e20] text-white rounded-md font-sans text-sm font-medium uppercase tracking-widest" href="#">
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>landscape</span>
                        <span>Site Assessments</span>
                    </a>
                </nav>
            </aside>

            {/* Main Canvas */}
            <main className="ml-72 flex-1 p-12 max-w-[1440px]">
                {/* Header Shell */}
                <header className="flex justify-between items-start mb-12">
                    <div>
                        <nav className="flex items-center gap-2 mb-4 text-[#404943] text-[11px] font-bold uppercase tracking-[0.2em]">
                            <span>Registry</span>
                            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                            <span>Dalarna</span>
                            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                            <span className="text-[#0f5238]">Orsa</span>
                        </nav>
                        <h1 className="text-4xl font-extrabold tracking-tight text-[#191c1d]">Fastighetsdossier: Orsa Stackmora 3:12</h1>
                    </div>
                    <div className="flex gap-3">
                        <button className="bg-gradient-to-br from-[#0f5238] to-[#1b5e20] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-all shadow-lg flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">edit</span> Update Assessment
                        </button>
                    </div>
                </header>

                {/* Critical Risk Banner */}
                <section className="mb-12">
                    <div className="relative overflow-hidden bg-[#b91f20] rounded-xl p-8 flex items-center justify-between group">
                        <div className="relative z-10 flex items-center gap-8">
                            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30">
                                <span className="material-symbols-outlined text-4xl text-white" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                            </div>
                            <div>
                                <h2 className="text-white text-3xl font-black tracking-tight mb-1 uppercase">Riskklass: HÖG</h2>
                                <p className="text-white/80 font-medium max-w-xl">Denna fastighet uppvisar kritiska geotekniska indikatorer som kräver omedelbar tillsyn före vidare planprocess.</p>
                            </div>
                        </div>
                        <div className="text-right z-10">
                            <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-2">Sannolikhet för sättning</p>
                            <p className="text-white text-5xl font-black">94%</p>
                        </div>
                        {/* Abstract Pattern Background */}
                        <div className="absolute inset-0 opacity-10 pointer-events-none">
                            <div className="absolute right-0 top-0 w-96 h-96 bg-white rounded-full -mr-20 -mt-20 blur-3xl"></div>
                        </div>
                    </div>
                </section>

                {/* Asymmetric Data Grid */}
                <section className="grid grid-cols-12 gap-8 mb-12">
                    {/* Map Card */}
                    <div className="col-span-12 lg:col-span-7 h-[450px] rounded-2xl overflow-hidden relative group border border-[#707973]/10">
                        <img className="w-full h-full object-cover grayscale-[0.3] group-hover:scale-105 transition-transform duration-700" alt="Map" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAmX8ARKTW2EsCCUFrxmOBr0euuNTEYhBYQtgteeAoeeQ9Y_BXPxqYbFnY14WFydiOrhKpWxsk7tEUMjk9_ubx8uq0cGkLlqw7tRcDgg80WGWchIVl4k7g1P74lLGoL7-gnuVhi0eZSiKAiZOHijAcxeSTAyNUYF_muDThp9D7I58QL7f36oxmp_H3gm9LaUa5siJwC4ZPmqrXSfkpJA3sUsOJG03soQgnQZGT8E5LRS64kmpe1iGUzMU5hwNi0X2CRR22yNC2u-g4" />
                        <div className="absolute bottom-8 left-8 right-8 flex justify-between items-end">
                            <div className="text-white">
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">Geospatial koordinat</p>
                                <p className="text-xl font-bold font-mono tracking-tight">61.1215° N, 14.6152° E</p>
                            </div>
                        </div>
                    </div>

                    {/* Metrics Column */}
                    <div className="col-span-12 lg:col-span-5 flex flex-col gap-8">
                        {/* Jordart Card */}
                        <div className="p-8 rounded-2xl bg-white border border-[#707973]/5 shadow-sm">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <p className="text-[#404943] text-[11px] font-black uppercase tracking-[0.2em] mb-1">Primär Jordart</p>
                                    <h3 className="text-3xl font-black text-[#191c1d]">Torv</h3>
                                </div>
                                <div className="bg-[#94000e]/10 text-[#94000e] px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter">
                                    Riskindikator
                                </div>
                            </div>
                            <p className="mt-4 text-sm text-[#404943] leading-relaxed">Organiskt material med hög vattenhalt. Risk för betydande sättningar vid belastning.</p>
                        </div>

                        {/* Vatten Card */}
                        <div className="p-8 rounded-2xl bg-white border border-[#707973]/5 shadow-sm relative overflow-hidden">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <p className="text-[#404943] text-[11px] font-black uppercase tracking-[0.2em] mb-1">Avstånd till ytvatten</p>
                                    <div className="flex items-baseline gap-2">
                                        <h3 className="text-4xl font-black text-[#94000e]">0</h3>
                                        <span className="text-xl font-bold text-[#191c1d] opacity-50">meter</span>
                                    </div>
                                </div>
                                <span className="material-symbols-outlined text-[#94000e] text-4xl opacity-20">water_drop</span>
                            </div>
                            <p className="text-sm text-[#404943] font-medium">Fastigheten gränsar direkt till vattendrag. Omedelbar risk för erosion och översvämning vid extremväder.</p>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};
