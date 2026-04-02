import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'ChunkLoadError' ||
      error.message.includes('Loading chunk') ||
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('Importing a module script failed')
    );
  }
  return false;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      isChunkError: isChunkLoadError(error),
    };
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleBack = () => {
    this.setState({ hasError: false, isChunkError: false });
    window.history.back();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-[#0a0a0a] text-white px-6 text-center gap-4">
        <span className="text-4xl">⚠️</span>
        <h1 className="text-xl font-semibold">
          {this.state.isChunkError
            ? 'Application updated'
            : 'Something went wrong'}
        </h1>
        <p className="text-[#9ca3af] text-sm max-w-xs">
          {this.state.isChunkError
            ? 'A new version is available. Reload to apply the update.'
            : 'An unexpected error occurred. Try reloading the page.'}
        </p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={this.handleBack}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-[#9ca3af] active:bg-[#2a2a2a]"
          >
            ← Back
          </button>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 rounded-lg bg-[#e31937] text-sm font-medium active:bg-[#c01530]"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
