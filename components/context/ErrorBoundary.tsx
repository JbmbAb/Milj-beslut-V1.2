import React, { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component for graceful error handling
 * Catches errors in child components and displays fallback UI
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: Readonly<ErrorBoundaryProps>;
  declare setState: React.Component<ErrorBoundaryProps, ErrorBoundaryState>['setState'];
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught an error:', error);
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback ? (
        this.props.fallback(this.state.error, this.retry)
      ) : (
        <DefaultErrorFallback error={this.state.error} onRetry={this.retry} />
      );
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

const DefaultErrorFallback: React.FC<DefaultErrorFallbackProps> = ({ error, onRetry }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div className="rounded-[28px] border border-red-200 bg-white px-8 py-10 text-center shadow-md max-w-md">
      <div className="mb-4 text-4xl">⚠️</div>
      <h2 className="text-xl font-black text-slate-900">Något gick fel</h2>
      <p className="mt-2 text-sm text-slate-600">{error.message || 'En oväntad fel uppstod. Försök igen.'}</p>
      <button
        onClick={onRetry}
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
      >
        Försök igen
      </button>
    </div>
  </div>
);

export default ErrorBoundary;
