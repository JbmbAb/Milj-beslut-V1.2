import React from 'react';

/**
 * PRODUCT-RUNTIME-ANSWER-BYPASS-01.
 *
 * Owner decision (frozen): no reachable freeform user surface may produce a legal/factual answer
 * outside the governed answer boundary (POST /api/legal/answer -> composeLegalAnswer()). This
 * component previously called POST /api/gemini {method:'askGeneralAssistant'} directly -- a
 * freeform chat with zero retrieval, zero citations, zero safety gate, while its own UI text
 * falsely claimed "Jag svarar enbart baserat på verifierade lagtexter... anger alltid
 * källhänvisning" (I answer only from verified sources, I always cite). Neither the Vertex
 * orchestrator path nor its bare-Gemini fallback ever touched the canonical chain.
 *
 * No legal-intent classifier was introduced to salvage the old chat UX -- deliberately, per the
 * owner's explicit instruction not to reintroduce a probabilistic boundary. This component is now
 * a non-generative launcher only: it makes zero network calls and holds zero conversation state.
 * Clicking it navigates to the real, governed Juridiskt Stöd view.
 *
 * If a general (non-legal) AI assistant is ever wanted again, it is a separate, proven capability
 * (GENERAL-ASSISTANT-GOVERNED-BOUNDARY or equivalent) -- not a silent restoration of this file.
 */

export interface ChatBotProps {
  onOpenLegalSupport: () => void;
}

const ChatBot: React.FC<ChatBotProps> = ({ onOpenLegalSupport }) => {
  return (
    <button
      type="button"
      onClick={onOpenLegalSupport}
      title="Juridiskt Stöd"
      className="fixed bottom-6 right-6 z-[2000] flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-2xl transition-all duration-300 hover:scale-105 hover:bg-indigo-500 active:scale-95"
    >
      <i className="fas fa-balance-scale text-xl" />
    </button>
  );
};

export default ChatBot;
