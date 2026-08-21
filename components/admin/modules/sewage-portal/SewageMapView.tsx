/**
 * Sewage Map View
 * Interactive map for placement of individual sewage systems.
 * Features: AI-suggested placement, manual dragging, and compliance assessment.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, Zap, AlertTriangle, RefreshCcw } from 'lucide-react';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../../types';
import { generateSewageSitingAssessment } from '../../../../services/geminiService';
import { useOperationsCenter } from '../../../context/OperationsCenterContext';
import { useTheme } from '../../../context/ThemeContext';
import { useAppWorkspace } from '../../../app/providers/AppWorkspaceProvider';
import './sewage-map.css';

interface SewageMapViewProps {
  analysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
  onPositionLocked?: (position: { x: number, y: number }, assessment: string) => void;
}

const SewageMapView: React.FC<SewageMapViewProps> = ({ analysis, protectionProfile, onPositionLocked }) => {
  const { addAiActivity, setInspectorData } = useOperationsCenter();
  const { isDark } = useTheme();
  const workspace = useAppWorkspace();

  const mapWidth = 800;
  const mapHeight = 500;
  const scale = 5; // pixels per meter

  // Center is property center
  const centerX = mapWidth / 2;
  const centerY = mapHeight / 2;

  // Connection point (house/building) - Static reference
  const connectionPoint = { x: -20, y: 15 }; // meters from center
  const connCoords = {
    x: centerX + connectionPoint.x * scale,
    y: centerY - connectionPoint.y * scale
  };

  // State for system position
  const [systemPos, setSystemPos] = useState({ x: 25, y: -10 }); // Default/AI suggested start
  const [isDragging, setIsDragging] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [assessment, setAssessment] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);

  // Constants for property (simulated for now, would come from PostGIS)
  const propWidth = 60; // meters
  const propHeight = 80;

  const toMapX = (mX: number) => centerX + mX * scale;
  const toMapY = (mY: number) => centerY - mY * scale;

  // Well position (from analysis)
  const wellPos = { x: -40, y: -30 };
  const wellCoords = { x: toMapX(wellPos.x), y: toMapY(wellPos.y) };

  // Calculate dynamic distances
  const getDistance = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const distToWell = getDistance(systemPos, wellPos);
  const distToConn = getDistance(systemPos, connectionPoint);
  
  // Distance to nearest property line (box logic)
  const distToBoundary = Math.min(
    propWidth / 2 - Math.abs(systemPos.x),
    propHeight / 2 - Math.abs(systemPos.y)
  );

  // Sync state changes with Inspector data and log actions
  useEffect(() => {
    setInspectorData({
      title: 'Infiltrationspunkt (Placering)',
      subtitle: `Ärende 24-0387 • ${workspace?.activeProjectLabel || analysis?.propertyId || 'STACKMORA 3:12'}`,
      type: 'sewage_point',
      confidence: 94,
      status: distToWell < 50 || distToBoundary < 4.5 ? 'danger' : 'success',
      statusText: distToWell < 50 || distToBoundary < 4.5 ? 'Konflikt med skyddszon' : 'Godkänd placering',
      metadata: {
        'Koordinater (relativa)': `X: ${systemPos.x.toFixed(1)}m, Y: ${systemPos.y.toFixed(1)}m`,
        'Avstånd till brunn': `${distToWell.toFixed(1)}m (krav: 50m)`,
        'Avstånd till tomtgräns': `${distToBoundary.toFixed(1)}m (krav: 4.5m)`,
        'Ledningslängd': `${distToConn.toFixed(1)}m`,
        'Marklutning (NNH)': '4% (Källa: NNH)',
        'Avstånd till granne': '14m (Källa: Fastighetskartan)',
      },
      explainText: distToWell < 50 
        ? 'VARNING: Avståndet till dricksvattenbrunn är under det lagstadgade kravet på 50 meter enligt HVMFS 2016:17. Detta kan leda till biologisk och kemisk förorening av dricksvattnet. Justera omedelbart placeringen så att avståndet är minst 50 meter.' 
        : distToBoundary < 4.5 
          ? 'OBSERVERA: Placeringen ligger närmare fastighetsgränsen än 4.5 meter. Enligt plan- och bygglagen samt miljöbalkens grannskapsrätt krävs skriftligt medgivande från berörda grannar innan systemet kan anläggas.' 
          : 'Placeringen uppfyller samtliga nationella skyddsavstånd och miljökrav. SGU-jordartsdata indikerar sandig morän som har god infiltrationskapacitet (LTAR 40). Ingen konflikt med vattenskyddsområdets yttre skyddszon.',
      sources: [
        { id: 'hvmfs-2016', title: 'HVMFS 2016:17 Allmänna råd', type: 'Vägledning', citation: 'Skyddsavstånd till dricksvattentäkt bör uppgå till minst 50 meter.' },
        { id: 'pbl', title: 'Plan- och bygglag (2010:900) 8 kap', type: 'Lagbok', citation: 'Byggnadsverk ska placeras och utformas så att de inte orsakar betydande olägenheter för grannar.' }
      ]
    });
  }, [systemPos.x, systemPos.y, distToWell, distToBoundary, distToConn, setInspectorData]);

  // Log dragging completion or movements occasionally
  const handleDragEnd = () => {
    setIsDragging(false);
    addAiActivity(
      `Infiltrationspunkt uppdaterad. Avstånd brunn: ${distToWell.toFixed(1)}m, gräns: ${distToBoundary.toFixed(1)}m.`, 
      distToWell < 50 || distToBoundary < 4.5 ? 'warning' : 'success'
    );
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLocked) return;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !svgRef.current || isLocked) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert back to meters relative to center
    const mX = (x - centerX) / scale;
    const mY = (centerY - y) / scale;

    // Constrain within property boundaries
    const constrainedX = Math.max(-propWidth/2 + 2, Math.min(propWidth/2 - 2, mX));
    const constrainedY = Math.max(-propHeight/2 + 2, Math.min(propHeight/2 - 2, mY));

    setSystemPos({ x: constrainedX, y: constrainedY });
  };

  const handleMapClick = (e: React.MouseEvent) => {
    if (isLocked || isDragging || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to meters relative to center
    const mX = (x - centerX) / scale;
    const mY = (centerY - y) / scale;

    // Check if click is reasonably inside the canvas
    if (Math.abs(mX) <= propWidth/2 + 10 && Math.abs(mY) <= propHeight/2 + 10) {
      const constrainedX = Math.max(-propWidth/2 + 2, Math.min(propWidth/2 - 2, mX));
      const constrainedY = Math.max(-propHeight/2 + 2, Math.min(propHeight/2 - 2, mY));
      setSystemPos({ x: constrainedX, y: constrainedY });
      addAiActivity(
        `Placerade infiltrationspunkt via klick på x: ${constrainedX.toFixed(1)}m, y: ${constrainedY.toFixed(1)}m.`,
        'info'
      );
    }
  };

  const handleLockPosition = async () => {
    if (isLocked) {
      setIsLocked(false);
      setAssessment(null);
      addAiActivity('Infiltrationspunkt olåst för omplacering.', 'info');
      return;
    }

    setIsLocked(true);
    setIsAnalyzing(true);
    addAiActivity('Låser position och kör miljöanalys...', 'info');

    try {
      const prompt = `Analysera placering av enskilt avlopp (typ: ${protectionProfile.recommendedSystem}) på fastigheten.
      
DATA:
- Avstånd till anslutningspunkt (hus): ${distToConn.toFixed(1)}m
- Avstånd till egen brunn: ${distToWell.toFixed(1)}m
- Avstånd till tomtgräns: ${distToBoundary.toFixed(1)}m
- Skyddsnivå för området: ${protectionProfile.protectionLevel}
- Jordart: ${analysis.sguJordartData.soilType}

KRAV:
1. Minst 50m till brunn (viktigt!).
2. Minst 4.5m till tomtgräns.
3. Ledningslängd från hus bör inte vara orimligt lång (ekonomi/lutning).

UPPGIFT:
Tala om vilka förutsättningar som förbättras eller försämras med denna specifika placering jämfört med det optimala. Svara kortfattat i punktform på svenska.`;

      const feedback = await generateSewageSitingAssessment(prompt);
      setAssessment(feedback);
      addAiActivity('✓ Miljöanalys slutförd för vald placering.', 'success');
      if (onPositionLocked) onPositionLocked(systemPos, feedback);
    } catch (err) {
      setAssessment("Kunde inte generera analys för tillfället.");
      addAiActivity('Analys misslyckades på grund av nätverksfördröjning.', 'warning');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className={`sewage-map-container ${isDark ? 'dark-theme bg-slate-900/40' : 'bg-white'}`}>
      <div className="sewage-map-layout">
        {/* Sidebar for Controls & Stats */}
        <div className={`sewage-map-sidebar border-r ${isDark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
          <div className="sewage-map-stat-card">
            <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
              <Zap size={14} className="text-cyan-400" /> Aktuell Placering
            </h4>
            
            <div className="mt-4 space-y-3">
              <div className={`sewage-stat-row p-2.5 rounded-xl border flex justify-between items-center ${
                distToWell < 50 
                  ? (isDark ? 'bg-red-950/20 border-red-900/40 text-red-400' : 'bg-red-50 border-red-100 text-red-700') 
                  : (isDark ? 'bg-slate-950/30 border-slate-800/80 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700')
              }`}>
                <span className="text-[11px] font-semibold">Avstånd till brunn</span>
                <span className="font-bold text-xs">{distToWell.toFixed(1)}m</span>
              </div>
              
              <div className={`sewage-stat-row p-2.5 rounded-xl border flex justify-between items-center ${
                distToBoundary < 4.5 
                  ? (isDark ? 'bg-amber-950/20 border-yellow-900/40 text-amber-400' : 'bg-amber-50 border-amber-100 text-amber-700') 
                  : (isDark ? 'bg-slate-950/30 border-slate-800/80 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700')
              }`}>
                <span className="text-[11px] font-semibold">Avstånd tomtgräns</span>
                <span className="font-bold text-xs">{distToBoundary.toFixed(1)}m</span>
              </div>
              
              <div className={`sewage-stat-row p-2.5 rounded-xl border flex justify-between items-center ${
                isDark ? 'bg-slate-950/30 border-slate-800/80 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
                <span className="text-[11px] font-semibold">Ledningslängd</span>
                <span className="font-bold text-xs">{distToConn.toFixed(1)}m</span>
              </div>
            </div>

            <button 
              onClick={handleLockPosition}
              disabled={isAnalyzing}
              className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black tracking-tight uppercase transition-all ${
                isLocked 
                  ? (isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300') 
                  : 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/30 hover:bg-cyan-500'
              }`}
            >
              {isAnalyzing ? <RefreshCcw size={14} className="animate-spin" /> : <Zap size={14} />}
              {isLocked ? 'Lås upp placering' : 'Lås & Kör Miljöanalys'}
            </button>
          </div>

          {assessment && (
            <div className={`sewage-map-assessment p-3.5 rounded-2xl border mt-4 animate-in fade-in slide-in-from-top-2 duration-300 ${
              isDark ? 'bg-slate-950/60 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="mb-2 flex items-center gap-2 border-b border-slate-800/20 pb-1.5">
                <AlertTriangle size={14} className="text-cyan-400" />
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">AI-Granskning</h4>
              </div>
              <div className={`prose prose-sm leading-relaxed text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {assessment.split('\n').map((line, idx) => (
                  <p key={idx} className="my-1">{line}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Interactive Map */}
        <div className="sewage-map-main relative flex-1 h-full" onClick={handleMapClick}>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            className={`sewage-map-canvas h-full w-full ${isLocked ? 'locked' : 'interactive'}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            style={{ minHeight: '450px' }}
          >
            {/* Background Grid */}
            <defs>
              <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke={isDark ? "#1e293b" : "#f1f5f9"} strokeWidth="0.5" />
              </pattern>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <rect width="50" height="50" fill="url(#smallGrid)" />
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke={isDark ? "#334155" : "#e2e8f0"} strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Property Polygon */}
            <rect 
              x={centerX - (propWidth/2) * scale} 
              y={centerY - (propHeight/2) * scale} 
              width={propWidth * scale} 
              height={propHeight * scale}
              fill={isDark ? "#1e293b/40" : "#ffffff"}
              stroke={isDark ? "#06b6d4" : "#475569"}
              strokeWidth="2.5"
              opacity={isDark ? 0.6 : 1}
              className="drop-shadow-sm"
            />

            {/* 10m Property border buffer overlay (offset inside property border) */}
            <rect 
              x={centerX - (propWidth/2 - 10) * scale} 
              y={centerY - (propHeight/2 - 10) * scale} 
              width={(propWidth - 20) * scale} 
              height={(propHeight - 20) * scale}
              fill="none"
              stroke="#e11d48"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.45"
            />
            <text 
              x={centerX - (propWidth/2 - 10) * scale + 10} 
              y={centerY - (propHeight/2 - 10) * scale - 6} 
              fontSize="9" 
              fontWeight="black" 
              fill="#e11d48" 
              opacity="0.8"
            >
              10m FASTIGHETSGRÄNS-BUFFERT
            </text>

            {/* Connection Point (Building) */}
            <g transform={`translate(${connCoords.x}, ${connCoords.y})`}>
              <rect x="-24" y="-18" width="48" height="36" rx="6" fill={isDark ? "#334155" : "#64748b"} stroke={isDark ? "#475569" : "none"} strokeWidth="1" />
              <path d="M -24 -18 L 0 -34 L 24 -18 Z" fill={isDark ? "#475569" : "#475569"} />
              <text y="32" textAnchor="middle" fontSize="9" fontWeight="black" fill={isDark ? "#94a3b8" : "#64748b"}>BYGGNAD</text>
            </g>

            {/* Well and its 50m skyddszon buffer circle overlay */}
            <g transform={`translate(${wellCoords.x}, ${wellCoords.y})`}>
              <circle r={50 * scale} fill="rgba(239, 68, 68, 0.03)" stroke="#e11d48" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.5" />
              <circle r="6" fill="#0066cc" />
              <text y="18" textAnchor="middle" fontSize="9" fontWeight="black" fill="#0066cc">EGEN BRUNN (SGU)</text>
              <text y="32" textAnchor="middle" fontSize="8" fontWeight="black" fill="#e11d48" opacity="0.8">50m SKYDDSZON (BRUNN)</text>
            </g>

            {/* Dynamic Distance Lines (Building to System) */}
            <line 
              x1={connCoords.x} y1={connCoords.y} 
              x2={toMapX(systemPos.x)} y2={toMapY(systemPos.y)} 
              stroke={isDark ? "#475569" : "#94a3b8"} 
              strokeDasharray="4 4" 
              strokeWidth="1.5"
            />

            {/* Dynamic Distance Lines (Well to System) */}
            <line 
              x1={wellCoords.x} y1={wellCoords.y} 
              x2={toMapX(systemPos.x)} y2={toMapY(systemPos.y)} 
              stroke={distToWell < 50 ? '#e11d48' : '#06b6d4'} 
              strokeWidth={distToWell < 50 ? 2.5 : 1.5}
              strokeDasharray="4 4" 
            />

            {/* Draggable System */}
            <g 
              transform={`translate(${toMapX(systemPos.x)}, ${toMapY(systemPos.y)})`}
              onMouseDown={handleMouseDown}
              className={`cursor-move transition-transform ${isDragging ? 'scale-110' : ''} ${isLocked ? 'pointer-events-none' : ''}`}
            >
              <circle r="14" fill={isLocked ? "#475569" : "#0891b2"} className="drop-shadow-md" />
              <path d="M -5 -3 L 5 -3 L 0 5 Z" fill="white" />
              <text y="-22" textAnchor="middle" fontSize="10" fontWeight="black" fill={isLocked ? "#94a3b8" : "#06b6d4"}>
                {isLocked ? 'PLACERAD' : 'AVLOPPSANLÄGGNING'}
              </text>
              {isLocked && <circle r="18" fill="none" stroke="#475569" strokeWidth="1.5" className="animate-pulse" />}
            </g>
          </svg>

          {/* Legend Overlay */}
          <div className={`absolute bottom-4 left-4 flex gap-4 rounded-xl p-3 text-[9px] font-black uppercase tracking-wider border shadow-2xl backdrop-blur-md ${
            isDark ? 'bg-slate-950/80 border-slate-800/80 text-slate-400' : 'bg-white/95 border-slate-200 text-slate-600'
          }`}>
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-cyan-600" /> ANLÄGGNING</div>
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-full bg-blue-600" /> BRUNN</div>
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-slate-500" /> BYGGNAD</div>
            <div className="flex items-center gap-1.5"><div className="h-2 w-4 bg-rose-500 opacity-60 border border-dashed border-rose-700" /> BUFFERZONER</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SewageMapView;
