import { useState, useEffect } from 'react';
import type { WorkoutDay } from './data/program';
import { getStoredProgram, saveStoredProgram, removeExerciseFromProgram } from './data/programStore';
import { getLoggedInUser, pullSync, pushSync } from './data/sync';
import type { SyncUser } from './data/sync';
import { migrateExerciseIds } from './db/database';
import Dashboard from './components/Dashboard';
import WorkoutView from './components/WorkoutView';
import HistoryView from './components/HistoryView';
import DayEditView from './components/DayEditView';
import ExerciseListView from './components/ExerciseListView';
import ExerciseMetaView from './components/ExerciseMetaView';
import MetricsView from './components/MetricsView';
import LoginView from './components/LoginView';
import './App.css';

type View =
  | { screen: 'dashboard' }
  | { screen: 'workout'; dayId: number }
  | { screen: 'history' }
  | { screen: 'edit-session'; sessionId: number; dayId: number }
  | { screen: 'edit-day'; dayId: number }
  | { screen: 'exercise-list' }
  | { screen: 'exercise-meta'; exerciseId: string; exerciseName: string }
  | { screen: 'metrics' };

function App() {
  const [view, setView]       = useState<View>({ screen: 'dashboard' });
  const [program, setProgram] = useState<WorkoutDay[]>(getStoredProgram);
  const [user]                = useState<SyncUser | null>(() => getLoggedInUser());

  // On mount: pull from server if logged in; if server is empty, push local data up.
  // The exercise-ID migration runs independently of pull so a sync failure can't
  // skip it; any remapped logs are pushed back up.
  useEffect(() => {
    if (!user) return;
    (async () => {
      let didPull = false;
      try {
        didPull = await pullSync();
        if (didPull) setProgram(getStoredProgram());
      } catch (err) {
        console.error(err);
      }
      try {
        const migrated = await migrateExerciseIds();
        if (!didPull || migrated > 0) await pushSync();
      } catch (err) {
        console.error(err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function sync() {
    if (user) pushSync().catch(console.error);
  }

  function handleUpdateDay(updated: WorkoutDay) {
    const next = program.map(d => (d.id === updated.id ? updated : d));
    setProgram(next);
    saveStoredProgram(next);
    setView({ screen: 'dashboard' });
    sync();
  }

  const loginError = new URLSearchParams(window.location.search).get('error') ?? undefined;

  if (!user) {
    return (
      <div className="app">
        <LoginView error={loginError} />
      </div>
    );
  }

  if (view.screen === 'workout') {
    const day = program.find(d => d.id === view.dayId)!;
    return (
      <div className="app">
        <WorkoutView
          day={day}
          onBack={() => setView({ screen: 'dashboard' })}
          onComplete={() => { setView({ screen: 'dashboard' }); sync(); }}
        />
      </div>
    );
  }

  if (view.screen === 'history') {
    return (
      <div className="app">
        <HistoryView
          program={program}
          onBack={() => setView({ screen: 'dashboard' })}
          onEditSession={(sessionId, dayId) =>
            setView({ screen: 'edit-session', sessionId, dayId })
          }
        />
      </div>
    );
  }

  if (view.screen === 'edit-session') {
    const day = program.find(d => d.id === view.dayId)!;
    return (
      <div className="app">
        <WorkoutView
          day={day}
          existingSessionId={view.sessionId}
          onBack={() => setView({ screen: 'history' })}
          onComplete={() => { setView({ screen: 'history' }); sync(); }}
        />
      </div>
    );
  }

  if (view.screen === 'edit-day') {
    const day = program.find(d => d.id === view.dayId)!;
    return (
      <div className="app">
        <DayEditView
          day={day}
          onBack={() => setView({ screen: 'dashboard' })}
          onSave={handleUpdateDay}
        />
      </div>
    );
  }

  if (view.screen === 'exercise-list') {
    return (
      <div className="app">
        <ExerciseListView
          onBack={() => setView({ screen: 'dashboard' })}
          onSelectExercise={(exerciseId, exerciseName) =>
            setView({ screen: 'exercise-meta', exerciseId, exerciseName })
          }
        />
      </div>
    );
  }

  if (view.screen === 'metrics') {
    return (
      <div className="app">
        <MetricsView onBack={() => setView({ screen: 'dashboard' })} />
      </div>
    );
  }

  if (view.screen === 'exercise-meta') {
    return (
      <div className="app">
        <ExerciseMetaView
          exerciseId={view.exerciseId}
          exerciseName={view.exerciseName}
          onBack={() => setView({ screen: 'exercise-list' })}
          onSaved={sync}
          onDeleted={() => {
            setProgram(p => removeExerciseFromProgram(view.exerciseId, p));
            setView({ screen: 'exercise-list' });
            sync();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>LiftLog</h1>
        <a href="/api/auth/logout" className="logout-btn">{user.name?.split(' ')[0] ?? user.email} ↩</a>
      </header>
      <main className="app-main">
        <Dashboard
          program={program}
          onStartWorkout={dayId => setView({ screen: 'workout', dayId })}
          onEditDay={dayId => setView({ screen: 'edit-day', dayId })}
          onViewHistory={() => setView({ screen: 'history' })}
          onViewExercises={() => setView({ screen: 'exercise-list' })}
          onViewMetrics={() => setView({ screen: 'metrics' })}
        />
      </main>
    </div>
  );
}

export default App;
