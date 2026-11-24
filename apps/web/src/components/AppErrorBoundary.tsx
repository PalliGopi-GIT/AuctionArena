import React from 'react';

interface State { error: Error | null }

/**
 * A render failure must not leave the arena as a blank page. The auction state
 * lives on the server, so a reload is always the safe recovery path.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('AuctionArena render error', error.name, error.message,
      (info.componentStack ?? '').split('\n').slice(0, 6).join(' '));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main id="main-content" tabIndex={-1} className="workspace" role="alert">
      <div className="panel">
        <span className="eyebrow">SOMETHING WENT WRONG</span>
        <h1 className="page-title">The arena hit an unexpected error.</h1>
        <p className="muted">Your auction is saved on the server. Reload to rejoin, or return to your auctions.</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="button" onClick={() => location.reload()}>Reload the arena</button>
          <button className="button secondary" onClick={() => { history.replaceState(null, '', location.pathname); location.reload(); }}>Back to home</button>
        </div>
        <p className="fine-print">If this keeps happening, note the time and share it with the host.</p>
      </div>
    </main>;
  }
}
