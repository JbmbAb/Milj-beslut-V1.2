import React, { useEffect, useState } from 'react';
import { getPropertyExtract, PropertyData } from '../server/services/lantmaterietMock';

interface PropertyRegisterExtractProps {
    propertyId: string;
}

const PropertyRegisterExtract: React.FC<PropertyRegisterExtractProps> = ({ propertyId }) => {
    const [data, setData] = useState<PropertyData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const result = await getPropertyExtract(propertyId);
                setData(result);
            } catch (error) {
                console.error('Error fetching property data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [propertyId]);

    if (loading) {
        return (
            <div className="p-8 animate-pulse bg-white border border-slate-200">
                <div className="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
                <div className="h-8 bg-slate-200 rounded w-1/2 mb-6"></div>
                <div className="space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-full"></div>
                    <div className="h-4 bg-slate-200 rounded w-full"></div>
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                </div>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="bg-white border-2 border-slate-900 p-8 shadow-sm font-serif max-w-4xl mx-auto my-6 text-slate-900 overflow-hidden relative">
            {/* Vattenstämpel / Myndighets-känsla */}
            <div className="absolute top-4 right-8 opacity-10 pointer-events-none uppercase text-4xl font-black rotate-[-15deg] border-4 border-slate-900 p-2">
                Registerutdrag
            </div>

            <header className="border-b-2 border-slate-900 pb-4 mb-6">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold uppercase tracking-tight">Fastighetsutdrag</h1>
                        <p className="text-sm italic text-slate-600">Simulerad anslutning: Lantmäteriet (SFF 4.0)</p>
                    </div>
                    <div className="text-right text-xs">
                        <p>Utskriftsdatum: {new Date().toLocaleDateString('sv-SE')}</p>
                        <p>Referens: LM-{data.propertyId.replace(/\s+/g, '-')}</p>
                    </div>
                </div>
            </header>

            <section className="grid md:grid-cols-2 gap-8">
                <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Registerbeteckning</h2>
                    <p className="text-xl font-bold mb-6">{data.propertyId}</p>

                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Omfattning</h2>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase">Areal</p>
                            <p className="font-semibold">{data.area.toLocaleString('sv-SE')} m²</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase">Kommun</p>
                            <p className="font-semibold">{data.municipality}</p>
                        </div>
                    </div>

                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 border-b border-slate-200 pb-1">Ägarförhållanden</h2>
                    <p className="font-semibold mb-6">{data.ownerType}</p>
                </div>

                <div className="bg-slate-50 p-4 border border-slate-200">
                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Rättigheter & Belastningar</h2>

                    <div className="mb-4">
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Rättigheter (Förmåner)</p>
                        {data.rights.length > 0 ? (
                            <ul className="list-disc list-inside text-sm space-y-1">
                                {data.rights.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        ) : (
                            <p className="text-sm italic text-slate-400">Inga registrerade rättigheter</p>
                        )}
                    </div>

                    <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Belastningar (Servitut/Anmärkningar)</p>
                        {data.encumbrances.length > 0 ? (
                            <ul className="list-disc list-inside text-sm space-y-1">
                                {data.encumbrances.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        ) : (
                            <p className="text-sm italic text-slate-400">Inga registrerade belastningar</p>
                        )}
                    </div>
                </div>
            </section>

            <footer className="mt-12 pt-4 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
                <p>Registeruppgifter senast ändrade: {data.lastUpdated}</p>
                <p>Handlingens giltighet bör styrkas mot Lantmäteriets huvudregister.</p>
            </footer>
        </div>
    );
};

export default PropertyRegisterExtract;
