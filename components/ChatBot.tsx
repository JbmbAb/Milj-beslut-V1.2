import React, { useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
};

const ChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    const nextHistory: ChatMessage[] = [...messages, { role: 'user', content: userMsg }];
    setInput('');
    setMessages(nextHistory);
    setIsLoading(true);

    try {
      const token = typeof window !== 'undefined' ? String(window.localStorage.getItem(TOKEN_KEY) || '') : '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'askGeneralAssistant',
          payload: {
            message: userMsg,
            history: nextHistory,
          },
        }),
      });

      const json = (await response.json()) as { ok?: boolean; error?: string; result?: string };
      if (!response.ok || !json.ok) {
        if (response.status === 401) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'model',
              content: 'Session saknas. Logga in via admin för att använda AI-chatten.',
            },
          ]);
          return;
        }
        throw new Error(json.error || `HTTP ${response.status}`);
      }

      const modelText = String(json.result || '').trim() || 'Jag kunde inte generera ett svar just nu.';
      setMessages((prev) => [...prev, { role: 'model', content: modelText }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: 'Jag kunde tyvärr inte svara just nu. Kontrollera anslutning och API-status.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[2000] flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 flex h-[500px] w-80 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:w-96">
          <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-700 p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <i className="fas fa-sparkles text-lg" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Miljöbeslut AI-assistent</h3>
                <p className="text-[10px] text-blue-100">Drivs av Gemini API</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="rounded-full p-2 transition-colors hover:bg-white/10">
              <i className="fas fa-times" />
            </button>
          </div>

          <div ref={scrollRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
            {messages.length === 0 && (
              <div className="mt-10 px-4 text-center">
                <i className="fas fa-robot mb-4 block text-4xl text-slate-200" />
                <p className="text-sm text-slate-500">Hej! Jag svarar enbart baserat på verifierade lagtexter och handböcker. Jag gissar aldrig. Vad vill du veta om din fastighet eller avfallskod?</p>
              </div>
            )}

            {messages.map((message, idx) => (
              <div key={`${message.role}-${idx}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-tr-none bg-blue-600 text-white'
                      : 'rounded-tl-none border border-slate-200 bg-white text-slate-700 shadow-sm'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm italic text-slate-400">
                  <i className="fas fa-circle-notch fa-spin mr-2" />Analyserar...
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-100 bg-white p-4">
            <textarea
              placeholder="Skriv eller klistra in text här..."
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 custom-scrollbar"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as unknown as React.FormEvent);
                }
              }}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-50"
            >
              <i className="fas fa-paper-plane" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-all duration-300 hover:scale-110 ${
          isOpen ? 'rotate-90 bg-slate-800' : 'bg-gradient-to-br from-blue-500 to-indigo-600'
        }`}
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comment-dots'} text-xl`} />
        {!isOpen && <span className="absolute -right-1 -top-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-red-500" />}
      </button>
    </div>
  );
};

export default ChatBot;
