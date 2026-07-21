import React from 'react';
import { motion } from 'motion/react';

interface LoadingSpinnerProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'dark';
  className?: string;
}

/**
 * Reusable loading spinner component with customizable size and theme
 * Replaces generic spinner fallbacks with branded alternatives
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  label = 'Laddar...',
  size = 'md',
  variant = 'default',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-4',
    lg: 'h-12 w-12 border-4',
  };

  const colorClasses = {
    default: 'border-slate-300 border-t-slate-900',
    dark: 'border-white/10 border-t-emerald-500',
  };

  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className={`rounded-full ${sizeClasses[size]} ${colorClasses[variant]}`}
      />
      {label && <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>}
    </div>
  );
};

export default LoadingSpinner;
