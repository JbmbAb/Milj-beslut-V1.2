import React, { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  hoverable?: boolean;
  className?: string;
}

/**
 * Card component with optional header and footer
 */
export const Card: React.FC<CardProps> = ({
  children,
  header,
  footer,
  hoverable = false,
  className = '',
}) => {
  return (
    <div
      className={`
        rounded-2xl border border-slate-200 bg-white shadow-sm
        ${hoverable ? 'hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${className}
      `}
    >
      {header && <div className="border-b border-slate-200 px-6 py-4">{header}</div>}

      <div className="px-6 py-4">{children}</div>

      {footer && (
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 rounded-b-2xl">{footer}</div>
      )}
    </div>
  );
};

export default Card;
