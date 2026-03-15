import React, { useState, useEffect } from 'react';

interface Note {
  id: string;
  text: string;
  author: string;
  timestamp: string;
}

interface BtfaNoteWidgetProps {
  caseId: string;
}

export const BtfaNoteWidget: React.FC<BtfaNoteWidgetProps> = ({ caseId }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = () => {
    const token = localStorage.getItem('miljobeslut_admin_bearer');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  };

  // Hämta anteckningar från API
  useEffect(() => {
    let isMounted = true;
    
    const fetchNotes = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/cases/${caseId}/notes`, {
          headers: getHeaders()
        });
        if (!response.ok) {
            if (response.status === 404) {
                if (isMounted) setNotes([]);
                return;
            }
            throw new Error(`Serverfel: ${response.status}`);
        }
        const data = await response.json();
        if (isMounted) setNotes(data);
      } catch (err) {
        console.error("Kunde inte hämta anteckningar:", err);
        if (isMounted) setError("Kunde inte ansluta till anteckningstjänsten.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    if (caseId) {
        fetchNotes();
    }
    
    return () => { isMounted = false; };
  }, [caseId]);

  const saveNote = async () => {
    if (!input.trim()) return;
    
    const tempId = Date.now().toString();
    const optimisticNote: Note = {
      id: tempId,
      text: input,
      author: 'Jag', // I produktion: hämta från context/session
      timestamp: new Date().toISOString()
    };

    // Optimistisk UI-uppdatering
    setNotes(prev => [optimisticNote, ...prev]);
    setInput('');
    setError(null);

    try {
      const response = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ text: optimisticNote.text })
      });

      if (!response.ok) throw new Error('Kunde inte spara');
      
      const savedNote = await response.json();
      // Ersätt temporär not med den riktiga från servern
      setNotes(prev => prev.map(n => n.id === tempId ? savedNote : n));
    } catch (err) {
      console.error("Sparfel:", err);
      setError("Kunde inte spara anteckningen. Försök igen.");
      // Rulla tillbaka
      setNotes(prev => prev.filter(n => n.id !== tempId));
      setInput(optimisticNote.text);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm h-full flex flex-col max-h-[400px]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <i className="fas fa-pen-to-square text-indigo-500"></i>
          BTFA.Anteckning
        </h4>
        <div className="flex items-center gap-2">
            {isLoading && <i className="fas fa-circle-notch fa-spin text-slate-300 text-xs"></i>}
            <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-2 py-1 rounded border border-emerald-100">
            LIVE
            </span>
        </div>
      </div>

      <div className="space-y-3 mb-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
        {error && (
            <div className="bg-rose-50 text-rose-600 p-2 rounded-lg text-[10px] font-bold border border-rose-100 mb-2">
                {error}
            </div>
        )}
        {notes.length === 0 && !isLoading && !error && (
          <div className="text-center py-4 border-2 border-dashed border-slate-100 rounded-xl">
            <p className="text-[10px] text-slate-400 font-medium">Inga anteckningar registrerade.</p>
          </div>
        )}
        {notes.map(note => (
          <div key={note.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs animate-in fade-in slide-in-from-bottom-1 duration-300">
            <p className="text-slate-700 mb-2 leading-relaxed">{note.text}</p>
            <div className="flex justify-between items-center text-[9px] text-slate-400 uppercase font-bold tracking-wider">
              <span>{note.author}</span>
              <span>{new Date(note.timestamp).toLocaleString('sv-SE')}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 shrink-0">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveNote()}
          placeholder="Skriv en tjänsteanteckning..."
          className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          disabled={isLoading}
        />
        <button 
          onClick={saveNote}
          disabled={!input.trim() || isLoading}
          className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-black hover:bg-slate-800 disabled:opacity-50 transition-all"
        >
          Spara
        </button>
      </div>
    </div>
  );
};