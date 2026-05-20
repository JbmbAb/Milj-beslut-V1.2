import React, { useState } from 'react';
import './SourceTooltip.css'; // Vi kan lägga CSS här senare

interface SourceTooltipProps {
  children: React.ReactNode;
  sourceText: string;
  sourceLink?: string;
  lawChapter?: string;
}

/**
 * Komponent för att visa AI:ns källhänvisningar via hovring (tooltip).
 * Gör rapporten transparent och juridiskt spårbar.
 */
export const SourceTooltip: React.FC<SourceTooltipProps> = ({ 
  children, 
  sourceText, 
  sourceLink,
  lawChapter
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <span 
      className="relative inline-block border-b border-dashed border-gray-400 cursor-help"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      
      {isHovered && (
        <div className="absolute z-10 w-64 p-3 mt-2 text-sm text-white bg-gray-900 rounded shadow-lg -left-1/2">
          <div className="font-bold text-blue-300 mb-1">
            Källa: {lawChapter ? lawChapter : 'Föreskrift'}
          </div>
          <div className="text-gray-200">
            {sourceText}
          </div>
          {sourceLink && (
            <a 
              href={sourceLink} 
              target="_blank" 
              rel="noopener noreferrer"
              className="block mt-2 text-blue-400 underline hover:text-blue-300"
            >
              Läs originaldokument
            </a>
          )}
        </div>
      )}
    </span>
  );
};
