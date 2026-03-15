import React, { useState } from 'react';
import { WasteCode } from '../types';

export interface RequirementCitation {
    id: string;
    quoteText: string;
    sourceType: string;
    legalReference: string;
}

interface RequirementChecklistProps {
    code: WasteCode;
    citations?: RequirementCitation[];
}

const RequirementChecklist: React.FC<RequirementChecklistProps> = ({ code, citations = [] }) => {
    const [hoveredCitation, setHoveredCitation] = useState<string | null>(null);

    const getCitationForLabel = (label: string) => {
        return citations.find(c => c.sourceType.toLowerCase() === label.toLowerCase());
    }

    return (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-white">
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-300 font-black mb-4">Checklista för regelefterlevnad</p>

            <div className="space-y-4">
                <ChecklistItem
                    label="Lagringstid"
                    value={code.requirements.storageTime || 'Max 1 år inomhus, 3 år deponi'}
                    reference={code.requirements.legalReference}
                    citation={getCitationForLabel('Lagringstid')}
                    isHovered={hoveredCitation === 'Lagringstid'}
                    onHover={() => setHoveredCitation('Lagringstid')}
                    onLeave={() => setHoveredCitation(null)}
                />
                <ChecklistItem
                    label="Maxmängd"
                    value={code.requirements.maxAmount || 'Ej begränsad upp till tillståndsnivån'}
                    reference={code.requirements.legalReference}
                    citation={getCitationForLabel('Maxmängd')}
                    isHovered={hoveredCitation === 'Maxmängd'}
                    onHover={() => setHoveredCitation('Maxmängd')}
                    onLeave={() => setHoveredCitation(null)}
                />
                <ChecklistItem
                    label="Skyddsavstånd"
                    value={code.requirements.safetyDistance || 'Standardkrav enligt gällande praxis'}
                    reference={code.requirements.legalReference}
                    citation={getCitationForLabel('Skyddsavstånd')}
                    isHovered={hoveredCitation === 'Skyddsavstånd'}
                    onHover={() => setHoveredCitation('Skyddsavstånd')}
                    onLeave={() => setHoveredCitation(null)}
                />

                {citations.length > 0 && citations.filter(c => !['Lagringstid', 'Maxmängd', 'Skyddsavstånd'].includes(c.sourceType)).map((cit, idx) => (
                    <ChecklistItem
                        key={idx}
                        label={cit.sourceType}
                        value={cit.quoteText.substring(0, 50) + '...'}
                        reference={cit.legalReference}
                        citation={cit}
                        isHovered={hoveredCitation === cit.sourceType}
                        onHover={() => setHoveredCitation(cit.sourceType)}
                        onLeave={() => setHoveredCitation(null)}
                    />
                ))}
            </div>
        </div>
    );
};

interface ChecklistItemProps {
    label: string;
    value: string;
    reference: string;
    citation?: RequirementCitation;
    isHovered: boolean;
    onHover: () => void;
    onLeave: () => void;
}

const ChecklistItem: React.FC<ChecklistItemProps> = ({ label, value, reference, citation, isHovered, onHover, onLeave }) => {

    // Mock citation if none provided for MVP demo purposes
    const displayCitation = citation || {
        quoteText: `Enligt aktuella bestämmelser måste ${label.toLowerCase()} strikt följas. ${value}. (Simulerat citat från vektor DB).`,
        legalReference: reference
    }

    return (
        <div className="relative group" onMouseEnter={onHover} onMouseLeave={onLeave}>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-blue-400/50 transition-colors cursor-help">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-300 flex items-center gap-2">
                        {label} <i className="fas fa-info-circle text-blue-400 opacity-50"></i>
                    </p>
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-blue-100">{reference}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-white">{value}</p>
            </div>

            {isHovered && (
                <div className="absolute z-50 left-full ml-4 top-0 w-80 bg-slate-800 border border-blue-500/30 shadow-2xl rounded-2xl p-4 animate-in fade-in slide-in-from-left-2 duration-200 pointer-events-none">
                    <div className="absolute -left-2 top-4 w-4 h-4 bg-slate-800 border-l border-b border-blue-500/30 rotate-45"></div>
                    <h4 className="text-[10px] font-black uppercase text-blue-400 tracking-widest mb-2 flex items-center gap-2">
                        <i className="fas fa-quote-left"></i> KÄLLHÄNVISNING
                    </h4>
                    <p className="text-sm italic text-slate-300 leading-relaxed mb-3">"{displayCitation.quoteText}"</p>
                    <div className="bg-slate-900 rounded-lg p-2 flex justify-between items-center border border-slate-700">
                        <span className="text-xs text-slate-400 font-medium">Källa: {displayCitation.legalReference}</span>
                        <i className="fas fa-external-link-alt text-blue-500 text-[10px]"></i>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RequirementChecklist;
