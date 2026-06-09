/**
 * Sewage Map View
 * Interactive map for placement of individual sewage systems.
 * Features: AI-suggested placement, manual dragging, and compliance assessment.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, Zap, AlertTriangle, CheckCircle2, RefreshCcw } from 'lucide-react';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../../types';
import { askGeneralAssistant } from '../../../../services/geminiService';
import './sewage-map.css';

interface SewageMapViewProps {
  analysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
  onPositionLocked?: (position: { x: number, y: number }, assessment: string) => void;
}

const SewageMapView: React.FC<SewageMapViewProps> = ({ analysis, protectionProfile, onPositionLocked }) => {
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
  const [isDragging, setIsGenerating] = useState(false);
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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLocked) return;
    setIsGenerating(true);
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

  const handleMouseUp = () => {
    setIsGenerating(false);
  };

  const handleLockPosition = async () => {
    if (isLocked) {
      setIsLocked(false);
      setAssessment(null);
      return;
    }

    setIsLocked(true);
    setIsAnalyzing(true);

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
Tala om vilka förutsättningar som förbättras eller försämras med denna specifika placering jämfört med det optimala. Svara kortfattat i punktform.`;

      const feedback = await askGeneralAssistant(prompt);
      setAssessment(feedback);
      if (onPositionLocked) onPositionLocked(systemPos, feedback);
    } catch (err) {
      setAssessment("Kunde inte generera analys för tillfället.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="sewage-map-container">
      <div className="sewage-map-layout">
        {/* Sidebar for Controls & Stats */}
        <div className="sewage-map-sidebar">
          <div className="sewage-map-stat-card">
            <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
              <Zap size={14} className="text-amber-500" /> Aktuell Placering
            </h4>
            
            <div className="mt-4 space-y-3">
              <div className={`sewage-stat-row ${distToWell < 50 ? 'text-red-600 bg-red-50' : 'text-slate-600'}`}>
                <span>Avstånd till brunn</span>
                <span className="font-bold">{distToWell.toFixed(1)}m</span>
              </div>
              <div className={`sewage-stat-row ${distToBoundary < 4.5 ? 'text-red-600 bg-red-50' : 'text-slate-600'}`}>
                <span>Avstånd tomtgräns</span>
                <span className="font-bold">{distToBoundary.toFixed(1)}m</span>
              </div>
              <div className="sewage-stat-row text-slate-600">
                <span>Ledningslängd</span>
                <span className="font-bold">{distToConn.toFixed(1)}m</span>
              </div>
            </div>

            <button 
              onClick={handleLockPosition}
              disabled={isAnalyzing}
              className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${
                isLocked 
                  ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' 
                  : 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700'
              }`}
            >
              {isAnalyzing ? <RefreshCcw size={16} className="animate-spin" /> : isLocked ? <Unlock size={16} /> : <Lock size={16} />}
              {isLocked ? 'Ändra position' : 'Lås position & Analysera'}
            </button>
          </div>

          {assessment && (
            <div className="sewage-map-assessment animate-in fade-in slide-in-from-top-2 duration-500">
              <div className="mb-3 flex items-center gap-2 border-b border-indigo-100 pb-2">
                <AlertTriangle size={16} className="text-indigo-600" />
                <h4 className="text-xs font-black uppercase tracking-tighter text-indigo-900">AI-Granskning</h4>
              </div>
              <div className="prose prose-sm prose-slate text-[13px] leading-relaxed text-slate-700">
                {assessment}
              </div>
            </div>
          )}
        </div>

        {/* Interactive Map */}
        <div className="sewage-map-main">
          <svg
            ref={svgRef}
            width={mapWidth}
            height={mapHeight}
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            className={`sewage-map-canvas ${isLocked ? 'locked' : 'interactive'}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Background Grid */}
            <defs>
              <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#f1f5f9" strokeWidth="0.5" />
              </pattern>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <rect width="50" height="50" fill="url(#smallGrid)" />
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Property Polygon */}
            <rect 
              x={centerX - (propWidth/2) * scale} 
              y={centerY - (propHeight/2) * scale} 
              width={propWidth * scale} 
              height={propHeight * scale}
              fill="#fff"
              stroke="#475569"
              strokeWidth="2"
              className="drop-shadow-sm"
            />

            {/* Connection Point (Building) */}
            <g transform={`translate(${connCoords.x}, ${connCoords.y})`}>
              <rect x="-20" y="-15" width="40" height="30" rx="4" fill="#64748b" />
              <path d="M -20 -15 L 0 -30 L 20 -15 Z" fill="#475569" />
              <text y="30" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#64748b">BYGGNAD</text>
            </g>

            {/* Well */}
            <g transform={`translate(${wellCoords.x}, ${wellCoords.y})`}>
              <circle r="30" fill="rgba(59, 130, 246, 0.05)" stroke="rgba(59, 130, 246, 0.2)" strokeDasharray="4 4" />
              <circle r="6" fill="#3b82f6" />
              <text y="18" textAnchor="middle" fontSize="9" fontWeight="black" fill="#3b82f6">BRUNN</text>
            </g>

            {/* Dynamic Distance Lines (Building to System) */}
            <line 
              x1={connCoords.x} y1={connCoords.y} 
              x2={toMapX(systemPos.x)} y2={toMapY(systemPos.y)} 
              stroke="#94a3b8" strokeDasharray="4 4" 
            />

            {/* Dynamic Distance Lines (Well to System) */}
            <line 
              x1={wellCoords.x} y1={wellCoords.y} 
              x2={toMapX(systemPos.x)} y2={toMapY(systemPos.y)} 
              stroke={distToWell < 50 ? '#ef4444' : '#3b82f6'} 
              strokeWidth={distToWell < 50 ? 2 : 1}
              strokeDasharray="4 4" 
            />

            {/* Draggable System */}
            <g 
              transform={`translate(${toMapX(systemPos.x)}, ${toMapY(systemPos.y)})`}
              onMouseDown={handleMouseDown}
              className={`cursor-move transition-transform ${isDragging ? 'scale-110' : ''} ${isLocked ? 'pointer-events-none' : ''}`}
            >
              <circle r="12" fill={isLocked ? "#475569" : "#f97316"} className="drop-shadow-md" />
              <path d="M -5 -3 L 5 -3 L 0 5 Z" fill="white" />
              <text y="-18" textAnchor="middle" fontSize="11" fontWeight="black" fill={isLocked ? "#475569" : "#f97316"}>
                {isLocked ? 'PLACERAD' : 'FLYTTBAR'}
              </text>
              {isLocked && <circle r="16" fill="none" stroke="#475569" strokeWidth="1" className="animate-pulse" />}
            </g>
          </svg>

          {/* Legend Overlay */}
          <div className="absolute bottom-4 left-4 flex gap-4 rounded-lg bg-white/90 p-3 text-[10px] font-bold text-slate-500 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-orange-500" /> ANLÄGGNING</div>
            <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-blue-500" /> BRUNN</div>
            <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-sm bg-slate-500" /> BYGGNAD</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SewageMapView;
