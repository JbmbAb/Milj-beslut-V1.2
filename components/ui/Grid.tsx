import React, { ReactNode } from 'react';

interface GridProps {
  children: ReactNode;
  cols?: number;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Responsive grid layout component
 */
export const Grid: React.FC<GridProps> = ({
  children,
  cols = 3,
  gap = 'md',
  className = '',
}) => {
  const gapClasses = {
    sm: 'gap-3',
    md: 'gap-6',
    lg: 'gap-8',
  };

  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${cols} ${gapClasses[gap]} ${className}`}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
};

export default Grid;
