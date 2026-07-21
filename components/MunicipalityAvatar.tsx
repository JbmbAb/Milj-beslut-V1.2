import React from 'react';

interface MunicipalityAvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const MunicipalityAvatar: React.FC<MunicipalityAvatarProps> = ({ name, size = 'md', className = '' }) => {
  // Rensa namnet för att matcha Wikipedia-standard (t.ex. "Haninge kommun" -> "Haninge")
  const cleanName = name.split(' ')[0].trim();

  // Storleksmappning
  const sizeClasses = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-10 h-10 text-xs',
    lg: 'w-16 h-16 text-base',
  };

  // URL till svenska kommunvapen på Wikimedia (standardiserat format)
  // De flesta följer mönstret: https://commons.wikimedia.org/wiki/Special:FilePath/Municipality_vapen.svg
  const heraldryUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${cleanName}_vapen.svg?width=100`;

  return (
    <div className={`relative group inline-flex ${className}`}>
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-40 p-2 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-[100] shadow-xl text-center leading-tight">
        Vapenskölden hämtas från Wikimedia Commons och kan saknas för vissa kommuner.
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800"></div>
      </div>

      <div
        className={`relative flex-shrink-0 flex items-center justify-center rounded-xl bg-white border border-slate-200 overflow-hidden shadow-sm ${sizeClasses[size]}`}
      >
        <img
          src={heraldryUrl}
          alt={`${name} vapen`}
          className="w-full h-full object-contain p-1.5"
          onError={(e) => {
            // Om bilden inte finns, visa initialer som fallback
            e.currentTarget.style.display = 'none';
            const parent = e.currentTarget.parentElement;
            if (parent && !parent.querySelector('.fallback-initials')) {
              const fallback = document.createElement('span');
              fallback.className = 'font-black text-slate-400 fallback-initials uppercase';
              fallback.innerText = cleanName.substring(0, 2).toUpperCase();
              parent.appendChild(fallback);
            }
          }}
        />
      </div>
    </div>
  );
};

export default MunicipalityAvatar;
