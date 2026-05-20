import React from 'react';
import './loading-spinner.css';

interface LoadingSpinnerProps {
  message?: string;
  fullHeight?: boolean;
}

/**
 * LoadingSpinner – Visuell feedback under datahämtning
 * WCAG 2.1 AA kompatibel med aria-busy
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Laddar...',
  fullHeight = false,
}) => {
  return (
    <div
      className={`loading-spinner ${fullHeight ? 'loading-spinner-full-height' : ''}`}
      role="status"
      aria-busy="true"
      aria-label={message}
    >
      <div className="loading-spinner-ring"></div>
      {message && <p className="loading-spinner-text">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
