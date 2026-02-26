
import React, { useState, useEffect } from 'react';
import MapView from './MapView';
import { Permit } from '../types';
import { MOCK_PERMITS } from '../constants';
import { motion, AnimatePresence } from 'motion/react';

const GisRiskModule: React.FC = () => {
  const [uploadedData, setUploadedData] = useState<any>(null);
  const [riskParameters, setRiskParameters] = useState({
    bufferDistance: 100,
    sensitivityLevel: 'Medium',
    includeFloodRisk: true,
    includeProtectedAreas: true,
  });
  const [analysisResult, setAnalysisResult] = useState<{
    score: number;
    conflicts: { text: string; layer?: string }[];
    recommendation: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [highlightedLayer, setHighlightedLayer] = useState<string | undefined>(undefined);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setUploadedData(json);
        // Reset analysis when new data is uploaded
        setAnalysisResult(null);
      } catch (err) {
        alert('Ogiltig GeoJSON-fil.');
      }
    };
    reader.readAsText(file);
  };

  const runAnalysis = () => {
    setIsAnalyzing(true);
    setHighlightedLayer(undefined);
    // Simulate complex GIS analysis
    setTimeout(() => {
      const conflicts = [];
      if (riskParameters.includeFloodRisk) conflicts.push({ text: 'Överlapp med 100-års översvämningszon (SMHI)', layer: 'smhi_flood' });
      if (riskParameters.includeProtectedAreas) conflicts.push({ text: 'Närhet till Natura 2000-område (< 200m)', layer: 'nv_natura' });
      conflicts.push({ text: 'Potentiell påverkan på fornlämningar i närområdet', layer: 'raa_fornsok' });

      setAnalysisResult({
        score: Math.floor(Math.random() * 40) + 30, // 30-70 range for demo
        conflicts,
        recommendation: 'Fördjupad miljöteknisk undersökning krävs. Justera projektgränsen 15m västerut för att undvika skyddszon.',
      });
      setIsAnalyzing(false);
    }, 2000);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 h-full animate-in fade-in duration-500">
      {/* Sidebar - Controls */}
      <div className="w-full lg:w-96 shrink-0 space-y-6">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 text-xl">
              <i className="fas fa-shield-virus"></i>
            </div>
            <div>
              <h3 className="text-xl font-black italic uppercase tracking-tight">Risk-Konfigurator</h3>
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Spatial Parametrisering</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Data Upload */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Spatial Data (GeoJSON)</label>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-3xl cursor-pointer hover:bg-slate-50 transition-all group">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <i className={`fas ${uploadedData ? 'fa-check-circle text-emerald-500' : 'fa-file-import text-slate-400'} text-2xl mb-2 group-hover:scale-110 transition-transform`}></i>
                  <p className="text-xs font-bold text-slate-500">{uploadedData ? 'Data laddad' : 'Dra & släpp GeoJSON'}</p>
                </div>
                <input type="file" className="hidden" accept=".json,.geojson" onChange={handleFileUpload} />
              </label>
            </div>

            {/* Parameters */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Buffertzon (m)</label>
                  <span className="text-[10px] font-black text-blue-600">{riskParameters.bufferDistance}m</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="500" 
                  step="10"
                  value={riskParameters.bufferDistance}
                  onChange={(e) => setRiskParameters({...riskParameters, bufferDistance: parseInt(e.target.value)})}
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Känslighetsnivå</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Low', 'Medium', 'High'].map(level => (
                    <button
                      key={level}
                      onClick={() => setRiskParameters({...riskParameters, sensitivityLevel: level})}
                      className={`py-2 rounded-xl text-[10px] font-black uppercase transition-all border ${
                        riskParameters.sensitivityLevel === level 
                          ? 'bg-slate-900 border-slate-900 text-white shadow-lg' 
                          : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <Toggle 
                  label="Inkludera Översvämning" 
                  active={riskParameters.includeFloodRisk} 
                  onClick={() => setRiskParameters({...riskParameters, includeFloodRisk: !riskParameters.includeFloodRisk})} 
                />
                <Toggle 
                  label="Skyddade Områden" 
                  active={riskParameters.includeProtectedAreas} 
                  onClick={() => setRiskParameters({...riskParameters, includeProtectedAreas: !riskParameters.includeProtectedAreas})} 
                />
              </div>
            </div>

            <button 
              disabled={!uploadedData || isAnalyzing}
              onClick={runAnalysis}
              className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                !uploadedData ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-200'
              }`}
            >
              {isAnalyzing ? (
                <><i className="fas fa-spinner fa-spin"></i> Analyserar...</>
              ) : (
                <><i className="fas fa-wand-magic-sparkles"></i> Kör Risk-Analys</>
              )}
            </button>
          </div>
        </div>

        {/* Analysis Result Card */}
        <AnimatePresence>
          {analysisResult && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black uppercase tracking-widest text-blue-400">Analysresultat</h4>
                <div className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-black">
                  SCORE: {analysisResult.score}/100
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Identifierade Konflikter (Klicka för att visa)</p>
                  <ul className="space-y-2">
                    {analysisResult.conflicts.map((c, i) => (
                      <li 
                        key={i} 
                        onClick={() => c.layer && setHighlightedLayer(c.layer)}
                        className={`flex items-start gap-3 text-xs p-2 rounded-xl transition-all cursor-pointer ${
                          highlightedLayer === c.layer ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <i className={`fas ${highlightedLayer === c.layer ? 'fa-eye' : 'fa-triangle-exclamation text-amber-500'} mt-0.5`}></i>
                        {c.text}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">Rekommendation</p>
                  <p className="text-xs text-slate-400 leading-relaxed italic">
                    "{analysisResult.recommendation}"
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Map View */}
      <div className="flex-1 bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden relative min-h-[600px]">
        <MapView 
          permits={MOCK_PERMITS} 
          geoJsonData={uploadedData}
          bufferDistance={riskParameters.bufferDistance}
          highlightLayer={highlightedLayer}
        />
        
        {/* Map Overlay for Analysis Status */}
        {isAnalyzing && (
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] z-[2000] flex items-center justify-center">
            <div className="bg-white p-8 rounded-[2rem] shadow-2xl flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-900">Spatial korsreferenskörning...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Toggle: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button 
    onClick={onClick}
    className="w-full flex items-center justify-between group"
  >
    <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">{label}</span>
    <div className={`w-10 h-5 rounded-full relative transition-all ${active ? 'bg-blue-600' : 'bg-slate-200'}`}>
      <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${active ? 'right-1' : 'left-1'}`}></div>
    </div>
  </button>
);

export default GisRiskModule;
