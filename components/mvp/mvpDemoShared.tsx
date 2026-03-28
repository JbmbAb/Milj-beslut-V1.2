import React from 'react';

type CardProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

export const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => (
  <div
    className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    onClick={onClick}
  >
    {children}
  </div>
);

type BadgeProps = {
  label: string;
  color?: string;
  className?: string;
  icon?: React.ReactNode;
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  color = 'bg-slate-100 text-slate-700',
  className = '',
  icon,
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-tight ${color} ${className}`}
  >
    {icon ? <span>{icon}</span> : null}
    {label}
  </span>
);
