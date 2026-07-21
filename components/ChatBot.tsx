import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

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

  const handleSend = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
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
            history: nextHistory.slice(-6), // Send last 6 messages for context
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
    } catch (err) {
      console.error('Chat error:', err);
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
        <div className="mb-4 flex h-[550px] w-80 flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:w-[420px]">
          <header className="flex shrink-0 items-center justify-between bg-slate-900 p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400">
                <i className="fas fa-balance-scale text-lg" />
              </div>
              <div>
                <h3 className="text-sm font-black tracking-tight">Legal AI Assistant</h3>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Verifierad Källa
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-xl p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <i className="fas fa-times" />
            </button>
          </header>

          <div ref={scrollRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto bg-slate-50 p-6">
            {messages.length === 0 && (
              <div className="mt-10 px-4 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <i className="fas fa-robot text-3xl text-indigo-600" />
                </div>
                <h4 className="font-bold text-slate-900">Välkommen till Miljöbeslut AI</h4>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Jag svarar enbart baserat på verifierade lagtexter, miljödomar och handböcker. 
                  Jag gissar aldrig och anger alltid källhänvisning.
                </p>
              </div>
            )}

            {messages.map((message, idx) => (
              <div
                key={`${message.role}-${idx}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-3xl px-5 py-4 text-sm shadow-sm ${
                    message.role === 'user'
                      ? 'rounded-tr-none bg-indigo-600 font-medium text-white'
                      : 'rounded-tl-none border border-slate-100 bg-white text-slate-700'
                  }`}
                >
                  {message.role === 'model' ? (
                    <div className="prose prose-sm prose-slate prose-indigo max-w-none">
                      <ReactMarkdown
                        components={{
                          a: ({ node, ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-black text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                            >
                              <i className="fas fa-external-link-alt text-[10px]" />
                              {props.children}
                            </a>
                          ),
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-5 py-3 text-xs font-bold text-slate-400 shadow-sm">
                  <i className="fas fa-circle-notch fa-spin text-indigo-400" />
                  Analyserar rättspraxis...
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="border-t border-slate-100 bg-white p-4">
            <div className="relative flex items-center gap-2">
              <textarea
                placeholder="Fråga om miljöbalken, domar eller avfall..."
                className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-4 pr-12 text-sm font-medium outline-none transition-all focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 custom-scrollbar"
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-1.5 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg transition-all hover:bg-indigo-600 disabled:opacity-30 active:scale-95"
              >
                <i className="fas fa-paper-plane text-xs" />
              </button>
            </div>
            <p className="mt-3 text-center text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
              Beslutsstöd • Ej juridiskt bindande
            </p>
          </form>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 ${
          isOpen ? 'bg-slate-900' : 'bg-indigo-600'
        }`}
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comment-alt-dots'} text-xl`} />
        {!isOpen && (
          <span className="absolute -right-1 -top-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-red-500" />
        )}
      </button>
    </div>
  );
};

export default ChatBot;
