import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import './error-alert.css';

interface ErrorAlertProps {
  message: string;
  onDismiss?: () => void;
  severity?: 'error' | 'warning' | 'info';
}

/**
 * ErrorAlert – Visuell feedback vid API-fel
 * WCAG 2.1 AA kompatibel med role="alert"
 */
export const ErrorAlert: React.FC<ErrorAlertProps> = ({ message, onDismiss, severity = 'error' }) => {
  return (
    <div className={`error-alert error-alert-${severity}`} role="alert" aria-live="polite">
      <div className="error-alert-content">
        <AlertCircle size={20} className="error-alert-icon" aria-hidden="true" />
        <p className="error-alert-message">{message}</p>
      </div>
      {onDismiss && (
        <button className="error-alert-close" onClick={onDismiss} aria-label="Stäng meddelande" title="Stäng">
          <X size={18} />
        </button>
      )}
    </div>
  );
};

export default ErrorAlert;
