import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { getUnfinishedWorkout, draftSetCount } from '../data/draftSession';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. A render-time throw anywhere in the tree used to
 * unmount the whole app to a white screen — mid-workout, with the sets in
 * React state. The draft in localStorage survives such a crash (it is written
 * on every set change), so the recovery screen says so and reloads to the
 * dashboard, where the "Resume unfinished workout" card picks it back up.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LiftLog crashed while rendering', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const draft = getUnfinishedWorkout();
    const sets = draftSetCount(draft);
    return (
      <div className="app">
        <div className="crash-screen" role="alert">
          <h1 className="crash-title">Something went wrong</h1>
          <p className="crash-detail">
            LiftLog hit an error it couldn't recover from on this screen.
            {sets > 0
              ? ` Your in-progress workout (${sets} logged set${sets === 1 ? '' : 's'}) is saved and will be offered when you reopen the app.`
              : ' Nothing you logged has been lost.'}
          </p>
          <pre className="crash-message">{error.message}</pre>
          <button className="crash-btn" onClick={() => { window.location.hash = ''; window.location.reload(); }}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}
