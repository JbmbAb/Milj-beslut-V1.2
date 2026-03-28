import React from 'react';

interface IconButtonProps {
  icon: React.ReactNode;
  ariaLabel: string;
  onClick?: () => void;
  tabIndex?: number;
  variant?: 'default' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  animate?: boolean;
}

/**
 * Reusable icon button component for compact, icon-focused actions
 */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  ariaLabel,
  onClick,
  tabIndex,
  variant = 'default',
  size = 'md',
  disabled = false,
  className = '',
  animate = false,
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  const variantClasses = {
    default:
      'bg-slate-800 border border-white/10 hover:border-white/20 text-slate-400 hover:text-white',
    secondary:
      'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 hover:text-white',
    ghost: 'hover:bg-white/5 text-slate-400 hover:text-white',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      className={`
        flex items-center justify-center rounded-2xl overflow-hidden
        transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${animate ? 'animate-spin' : ''}
        ${className}
      `}
    >
      {icon}
    </button>
  );
};

export default IconButton;
