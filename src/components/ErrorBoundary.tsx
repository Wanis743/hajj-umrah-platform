import { Component, type ReactNode } from 'react';
import { toUserMessage } from '@/lib/errors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div role="alert" style={{ padding: 24, fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#111' }}>
            <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#fef2f2', border: '1px solid #fecaca', padding: 12, borderRadius: 6 }}>
              {toUserMessage(this.state.error)}
            </pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
