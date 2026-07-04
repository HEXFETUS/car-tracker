import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error('Dashboard crashed:', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <div className="rounded-full bg-red-50 p-4 mb-4">
            <svg className="size-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-lg font-bold text-zinc-900">Something went wrong</p>
          <p className="text-sm text-zinc-400 mt-1 max-w-md text-center">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90">
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}