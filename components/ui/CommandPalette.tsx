import React, { useState, useEffect, useRef } from 'react';
import { useOperationsCenter } from '../context/OperationsCenterContext';

interface SearchItem {
  id: string;
  category: 'Verktyg' | 'Geodata' | 'Myndigheter' | 'Handlingar';
  title: string;
  description: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveStep,
    addAiActivity,
  } = useOperationsCenter();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // List of searchable items in Mimers Brunn
  const searchItems: SearchItem[] = [
    {
      id: 'prop-search',
      category: 'Verktyg',
      title: 'Fastighetssök (PostGIS)',
      description: 'Sök och visualisera fastighetsgränser för alla 21 län i Sverige',
      icon: 'fa-search-location text-cyan-400',
      shortcut: '↵',
      action: () => {
        setActiveStep(1);
        addAiActivity('Öppnade fastighetssökning', 'info');
      },
    },
    {
      id: 'nmd-raster',
      category: 'Geodata',
      title: 'Nationella Marktäckedata NMD 2023',
      description: '10.8 GB raster upplöst på 10m pixlar, laddat Out-of-DB från Master-arkivet',
      icon: 'fa-layer-group text-emerald-400',
      action: () => {
        setActiveStep(2);
        addAiActivity('Aktiverade NMD Marktäckedata-raster overlay', 'success');
      },
    },
    {
      id: 'sgu-wells',
      category: 'Geodata',
      title: 'SGU Brunnar & Grundvatten',
      description: 'Visa dricksvattenbrunnar och energibrunnar från SGU geodatabas',
      icon: 'fa-tint text-blue-400',
      action: () => {
        setActiveStep(2);
        addAiActivity('Laddade SGU grundvattenbrunnar lager', 'info');
      },
    },
    {
      id: 'protect-areas',
      category: 'Geodata',
      title: 'Naturreservat & Natura 2000',
      description: 'Skyddade områden från Naturvårdsverket (PostGIS polygoner)',
      icon: 'fa-tree text-green-400',
      action: () => {
        setActiveStep(4);
        addAiActivity('Laddade skyddade områden lager', 'info');
      },
    },
    {
      id: 'historic-sites',
      category: 'Geodata',
      title: 'Fornlämningar (RAÄ Fornsök)',
      description: 'Riksantikvarieämbetets databas över kulturhistoriska lämningar',
      icon: 'fa-landmark text-amber-500',
      action: () => {
        setActiveStep(3);
        addAiActivity('Söker fornlämningar i närområdet', 'info');
      },
    },
    {
      id: 'msb-flood',
      category: 'Geodata',
      title: 'MSB Översvämningskartering',
      description: 'Myndigheten för Samhällsskydd och Beredskaps riskzoner för 100-årsflöden',
      icon: 'fa-water text-indigo-400',
      action: () => {
        setActiveStep(4);
        addAiActivity('Aktiverade MSB översvämningslager', 'success');
      },
    },
    {
      id: 'c-notification',
      category: 'Verktyg',
      title: 'C-anmälan Schaktmassor',
      description: 'Mellanlagringsplatta och återvinning av avfall för anläggningsändamål',
      icon: 'fa-dumpster text-yellow-500',
      action: () => {
        setActiveStep(5);
        addAiActivity('Initierade C-anmälan för masshantering', 'info');
      },
    },
    {
      id: 'sewage-portal',
      category: 'Verktyg',
      title: 'Enskilt Avlopp Prövning',
      description: 'Lokaliseringsutredning och ritningsgenerering med CAD/Vertex AI',
      icon: 'fa-toilet text-pink-400',
      action: () => {
        setActiveStep(4);
        addAiActivity('Öppnade prövningsportal för enskilt avlopp', 'info');
      },
    },
  ];

  // Open on Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Focus input on open
  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
      setSearchQuery('');
    }
  }, [commandPaletteOpen]);

  // Filter items
  const filteredItems = searchItems.filter((item) =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle arrow/key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setCommandPaletteOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        setCommandPaletteOpen(false);
      }
    }
  };

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setCommandPaletteOpen(false);
    }
  };

  if (!commandPaletteOpen) return null;

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-start justify-center pt-[15vh] z-50 transition-all duration-200"
    >
      <div
        ref={containerRef}
        className="w-full max-w-2xl bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[60vh]"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <i className="fas fa-search text-slate-500 text-lg" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Sök verktyg, geodatager, myndigheter eller lagar..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="flex-1 bg-transparent border-0 outline-none text-slate-100 text-sm placeholder-slate-500"
          />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(false)}
            className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 font-bold px-2 py-1 rounded hover:bg-slate-700"
          >
            ESC
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-800">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
              <i className="fas fa-search-minus text-2xl text-slate-600" />
              <p className="text-xs text-slate-400 font-bold">Inga matchningar hittades</p>
              <p className="text-[10px] text-slate-500">Pröva att söka efter "NMD", "PostGIS" eller "C-anmälan"</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filteredItems.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      item.action();
                      setCommandPaletteOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center gap-3.5 px-4 py-3 rounded-xl cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-slate-800/80 border-l-4 border-cyan-500 pl-3'
                        : 'bg-transparent border-l-4 border-transparent'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-950/80 flex items-center justify-center border border-slate-800 shrink-0">
                      <i className={`fas ${item.icon} text-sm`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-100">{item.title}</span>
                        <span className="text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800 text-slate-400 uppercase">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{item.description}</p>
                    </div>
                    {item.shortcut && (
                      <span className="text-[9px] font-bold text-slate-500 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/80">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-[9px] text-slate-500 font-bold shrink-0">
          <div className="flex items-center gap-4">
            <span><kbd className="bg-slate-800 px-1 rounded">↓↑</kbd> Navigera</span>
            <span><kbd className="bg-slate-800 px-1 rounded">↵</kbd> Välj</span>
          </div>
          <span>Mimers Brunn Command Center v2.0</span>
        </div>
      </div>
    </div>
  );
};
