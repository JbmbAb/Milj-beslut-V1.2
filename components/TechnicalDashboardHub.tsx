import React from 'react';
import { motion } from 'framer-motion';
import {
    Map as MapIcon,
    ShieldCheck,
    ArrowRight,
    Search,
    Activity,
    User,
    BrainCircuit,
    ClipboardPen,
    Rocket
} from 'lucide-react';
import { TechnicalSluExpert } from './TechnicalSluExpert';

const MODULES = [
    {
        id: 'mvp',
        title: 'MVP Workflow',
        description: 'Snabbspår för klassificering och anmälan (Miljöbeslut.se MVP).',
        icon: <Rocket size={32} className="text-emerald-500" />,
        badge: 'NEW',
        accent: 'glow-emerald',
        delay: 0.05
    },
    {
        id: 'ansokan',
        title: 'Ansökningsportal',
        description: 'Automatiserade förhandsprövningar med stöd av 1500+ rättsdokument.',
        icon: <BrainCircuit size={32} className="text-indigo-500" />,
        badge: 'AI-SUPPORT',
        accent: 'glow-indigo',
        delay: 0.1
    },
    {
        id: 'logistik',
        title: 'Logistik & Massor',
        description: 'Interaktiv GIS-analys för optimering av deponier och transporter.',
        icon: <MapIcon size={32} className="text-teal-500" />,
        badge: 'GEOSPATIAL',
        accent: 'glow-teal',
        delay: 0.2
    },
    {
        id: 'projekt',
        title: 'Projektledning',
        description: 'Automatisk generering av anmälningshandlingar och bilagor för fastigheter.',
        icon: <ClipboardPen size={32} className="text-amber-500" />,
        badge: 'BACKLOG',
        accent: 'glow-amber',
        delay: 0.3
    },
    {
        id: 'gronkoll',
        title: 'Grönkoll (Score)',
        description: 'Real-time regelefterlevnads-score baserat på projektets riskprofil.',
        icon: <ShieldCheck size={32} className="text-rose-500" />,
        badge: 'COMPLIANCE',
        accent: 'glow-rose',
        delay: 0.4
    }
];

interface TechnicalDashboardHubProps {
    onSelectModule: (id: string) => void;
    user?: { name: string; avatar?: string };
}

export const TechnicalDashboardHub: React.FC<TechnicalDashboardHubProps> = ({ onSelectModule, user }) => {
    return (
        <div className="min-h-screen bg-[#060607] text-white selection:bg-indigo-500/30 font-['Inter']">
            {/* Top Navigation */}
            <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 bg-white/5 backdrop-blur-xl border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                        <Activity size={20} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tighter font-['Outfit']">RiskGuard<span className="text-indigo-500">.ai</span></h1>
                        <p className="text-[9px] uppercase font-black tracking-widest text-slate-500 -mt-1">Miljöbeslut 2.0</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="hidden md:flex items-center gap-4 bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
                        <Search size={16} className="text-slate-600" />
                        <input
                            type="text"
                            placeholder="Sök i kunskapsgraf..."
                            className="bg-transparent border-none outline-none text-xs font-bold text-slate-300 w-48 placeholder:text-slate-600"
                        />
                    </div>

                    <div className="flex items-center gap-3 pl-4 border-l border-white/10">
                        <div className="text-right">
                            <p className="text-xs font-black">{user?.name || 'Administratör'}</p>
                            <p className="text-[10px] text-slate-500">Premium Plan</p>
                        </div>
                        <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden">
                            <User size={20} className="text-slate-400" />
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="pt-32 pb-20 px-8 max-w-7xl mx-auto">
                <motion.section
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-16 text-center max-w-2xl mx-auto"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black tracking-widest uppercase mb-6">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                        Powered by Gemini 1.5 Pro
                    </div>
                    <h2 className="text-5xl md:text-6xl font-black font-['Outfit'] leading-tight mb-6 tracking-tight gradient-text">
                        Gör miljötillstånd enkelt och säkert
                    </h2>
                    <p className="text-slate-400 text-lg leading-relaxed mb-10">
                        Systematiserad handläggning med realtidsdata från Lantmäteriet, SMHI och juridiska arkiv.
                    </p>
                </motion.section>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {MODULES.map((module) => (
                        <motion.div
                            key={module.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: module.delay }}
                            onClick={() => onSelectModule(module.id)}
                            className={`group cursor-pointer p-8 rounded-[32px] bg-[#0F0F11] border border-white/5 hover:border-white/20 transition-all duration-500 relative overflow-hidden ${module.accent}`}
                        >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-[80px] group-hover:bg-indigo-500/20 transition-all duration-500" />

                            <div className="relative z-10">
                                <span className="inline-flex items-center justify-center p-4 bg-white/5 rounded-2xl mb-12 border border-white/5 group-hover:scale-110 transition-transform duration-500">
                                    {module.icon}
                                </span>

                                <span className="block text-[10px] font-black tracking-widest text-[#475569] uppercase mb-2 group-hover:text-white/50 transition-colors">
                                    {module.badge}
                                </span>

                                <h3 className="text-xl font-bold mb-3 font-['Outfit'] text-white">
                                    {module.title}
                                </h3>

                                <p className="text-slate-500 text-xs leading-relaxed mb-10 group-hover:text-slate-300 transition-colors">
                                    {module.description}
                                </p>

                                <div className="flex items-center gap-2 text-xs font-black text-indigo-400 group-hover:text-white transition-colors">
                                    Öppna modul <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    className="mt-20 grid md:grid-cols-3 gap-6"
                >
                    {[
                        { label: 'Bearbetade Dokument', value: '1 045', detail: '+12 sedan igår' },
                        { label: 'Analytisk Precision', value: '98.4%', detail: 'Högre konfidens' },
                        { label: 'Aktiv Handläggningstid', value: '-64%', detail: 'Tidsbesparing' },
                    ].map((stat, i) => (
                        <div key={i} className="p-6 rounded-3xl bg-white/5 border border-white/5 text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{stat.label}</p>
                            <div className="text-3xl font-black font-['Outfit'] mb-1">{stat.value}</div>
                            <p className="text-[10px] text-teal-400 font-bold uppercase">{stat.detail}</p>
                        </div>
                    ))}
                </motion.div>

                <motion.section
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                >
                    <TechnicalSluExpert />
                </motion.section>
            </main>
        </div>
    );
};

export default TechnicalDashboardHub;
