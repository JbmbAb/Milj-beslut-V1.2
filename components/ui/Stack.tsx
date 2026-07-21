import React, { ReactNode } from 'react';

interface StackProps {
  children: ReactNode;
  direction?: 'row' | 'col';
  spacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  className?: string;
}

/**
 * Flexible stack layout component
 * Simplifies flex layouts with consistent spacing
 */
export const Stack: React.FC<StackProps> = ({
  children,
  direction = 'col',
  spacing = 'md',
  align = 'stretch',
  justify = 'start',
  className = '',
}) => {
  const directionClass = direction === 'row' ? 'flex-row' : 'flex-col';

  const spacingClasses = {
    xs: direction === 'row' ? 'gap-2' : 'gap-2',
    sm: direction === 'row' ? 'gap-4' : 'gap-4',
    md: direction === 'row' ? 'gap-6' : 'gap-6',
    lg: direction === 'row' ? 'gap-8' : 'gap-8',
    xl: direction === 'row' ? 'gap-12' : 'gap-12',
  };

  const alignClasses = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  };

  const justifyClasses = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
  };

  return (
    <div
      className={`flex ${directionClass} ${spacingClasses[spacing]} ${alignClasses[align]} ${justifyClasses[justify]} ${className}`}
    >
      {children}
    </div>
  );
};

export default Stack;
