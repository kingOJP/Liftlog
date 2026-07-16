import { useState, useEffect } from 'react';
import type { WorkoutDay } from './data/program';
import { getStoredProgram, saveStoredProgram, removeExerciseFromProgram } from './data/programStore';
import { getLoggedInUser, ensureLocalDataOwner, pullSync, pushSync } from './data/sync';
import type { SyncUser } from './data/sync';
import { ensureJourneyMigrated, ensureWeekAnchor, startPendingActivation, reconcileActiveProgram } from './data/planStore';
import { migrateExerciseIds, ensureSessionGuids, purgeEmptySessions } from './db/database';
import Dashboard from './components/Dashboard';
import WorkoutView from './components/WorkoutView';
import HistoryView from './components/HistoryView';
import DayEditView from './components/DayEditView';
import ExerciseListView from './components/ExerciseListView';
import ExerciseMetaView from './components/ExerciseMetaView';
import MetricsView from './components/MetricsView';
import SettingsView from './components/SettingsView';
import LoginView from './components/LoginView';
import JourneyView from './components/JourneyView';
import PlanSetupView from './components/PlanSetupView';
import SharedWorkoutView from './components/SharedWorkoutView';
import {
  captureShareFromUrl, getPendingSharedWorkout, clearPendingShare,
  acceptSharedWorkout, SHARED_DAY_ID,
} from './data/share';
import './App.css';

type View =
  | { screen: 'dashboard' }
  | { screen: 'workout'; dayId: number }
  | { screen: 'history' }
  | { screen: 'edit-session'; sessionId: number; dayId: number }
  | { screen: 'edit-day'; dayId: number }
  | { screen: 'exercise-list' }
  | { screen: 'exercise-meta'; exerciseId: string; exerciseName: string }
  | { screen: 'metrics' }
  | { screen: 'settings' }
  | { screen: 'journey' }
  | { screen: 'plan-setup' }
  | { screen: 'shared-preview' }
  | { screen: 'shared-workout' };

function App() {
  // A scanned share link (/#share=…) is stashed in localStorage before
  // anything else — including the login redirect — so the import survives
  // OAuth and lands on the preview screen once the user is signed in.
  const [view, setView] = useState<View>(() => {
    captureShareFromUrl();
    return getPendingSharedWorkout() ? { screen: 'shared-preview' } : { screen: 'dashboard' };
  });
  const [program, setProgram] = useState<WorkoutDay[]>(getStoredProgram);
  const [user]                = useState<SyncUser | null>(() => getLoggedInUser());
  // A shared workout being done as a one-off (never added to the program)
  const [sharedDay, setSharedDay] = useState<WorkoutDay | null>(null);

  // On mount: pull from server if logged in; if server is empty, push local data up.
  // The exercise-ID migration runs independently of pull so a sync failure can't
  // skip it; any remapped logs are pushed back up.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        // If a different account signed in on this device, wipe the previous
        // account's local data BEFORE any sync — otherwise the startup push
        // would upload it into this account.
        await ensureLocalDataOwner();
        setProgram(getStoredProgram());
      } catch (err) {
        console.error(err);
      }
      try {
        await migrateExerciseIds();
        // Pin sync identities on pre-sync-v2 sessions before the first merge
        await ensureSessionGuids();
        await purgeEmptySessions();
      } catch (err) {
        console.error(err);
      }
      try {
        const didPull = await pullSync();
        if (didPull) setProgram(getStoredProgram());
      } catch (err) {
        console.error(err);
      }
      try {
        // Wrap pre-journey training (program + history, no plan) in a
        // Foundation block — after pull, so a plan synced from another
        // device wins over creating a fresh wrapper.
        await ensureJourneyMigrated();
        // A block approved mid-week installs its workouts on its start date
        if (await startPendingActivation()) setProgram(getStoredProgram());
        // Self-heal: if the live program was wiped (bad sync / update) but the
        // active block still holds its workouts, restore them before the push
        // below carries the repair up to the server.
        if (reconcileActiveProgram()) setProgram(getStoredProgram());
        // Week numbering follows the synced journey (block start / last block
        // end) — keeps devices consistent without a manual setting.
        ensureWeekAnchor();
      } catch (err) {
        console.error(err);
      }
      try {
        await migrateExerciseIds();
        await pushSync();
      } catch (err) {
        console.error(err);
      }
      // Force a fresh program reference so history/dashboard reload their
      // snapshot after the startup cleanup (purge, migration, pull).
      setProgram(getStoredProgram());
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull fresh data when the tab regains focus or every 60 s while visible
  useEffect(() => {
    if (!user) return;

    async function backgroundPull() {
      try {
        const didPull = await pullSync();
        // A pending block whose start date arrived while the app was open
        // installs here (the interval doubles as its scheduler).
        const started = await startPendingActivation();
        const healed = reconcileActiveProgram();
        if (didPull) ensureWeekAnchor();
        if (didPull || started || healed) setProgram(getStoredProgram());
        if (started || healed) pushSync().catch(() => {});
      } catch {
        // silent — background refresh is best-effort
      }
    }

    function onFocus() { backgroundPull(); }

    const interval = setInterval(backgroundPull, 60_000);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user]);

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

  // A stored view can reference a day that no longer exists (e.g. the program
  // was replaced by a sync) — fall back to the dashboard instead of crashing.
  const findDay = (dayId: number) => program.find(d => d.id === dayId);

  function renderView(): React.ReactNode {
    switch (view.screen) {
      case 'workout': {
        const day = findDay(view.dayId);
        if (!day) break;
        return (
          <WorkoutView
            day={day}
            program={program}
            onBack={() => setView({ screen: 'dashboard' })}
            onComplete={() => { setView({ screen: 'dashboard' }); sync(); }}
          />
        );
      }
      case 'edit-session': {
        const day = findDay(view.dayId);
        if (!day) break;
        return (
          <WorkoutView
            day={day}
            program={program}
            existingSessionId={view.sessionId}
            onBack={() => setView({ screen: 'history' })}
            onComplete={() => { setView({ screen: 'history' }); sync(); }}
          />
        );
      }
      case 'edit-day': {
        const day = findDay(view.dayId);
        if (!day) break;
        return (
          <DayEditView
            day={day}
            onBack={() => setView({ screen: 'dashboard' })}
            onSave={handleUpdateDay}
          />
        );
      }
      case 'history':
        return (
          <HistoryView
            program={program}
            onBack={() => setView({ screen: 'dashboard' })}
            onEditSession={(sessionId, dayId) =>
              setView({ screen: 'edit-session', sessionId, dayId })
            }
          />
        );
      case 'exercise-list':
        return (
          <ExerciseListView
            onBack={() => setView({ screen: 'dashboard' })}
            onSelectExercise={(exerciseId, exerciseName) =>
              setView({ screen: 'exercise-meta', exerciseId, exerciseName })
            }
          />
        );
      case 'exercise-meta':
        return (
          <ExerciseMetaView
            exerciseId={view.exerciseId}
            exerciseName={view.exerciseName}
            onBack={() => setView({ screen: 'exercise-list' })}
            onSaved={sync}
            onDeleted={() => {
              const exerciseId = view.exerciseId;
              setProgram(p => removeExerciseFromProgram(exerciseId, p));
              setView({ screen: 'exercise-list' });
              sync();
            }}
          />
        );
      case 'metrics':
        return <MetricsView program={program} onBack={() => setView({ screen: 'dashboard' })} />;
      case 'settings':
        return <SettingsView user={user!} onBack={() => setView({ screen: 'dashboard' })} />;
      case 'journey':
        return (
          <JourneyView
            onBack={() => setView({ screen: 'dashboard' })}
            onPlanNew={() => setView({ screen: 'plan-setup' })}
            onChanged={() => { setProgram(getStoredProgram()); sync(); }}
          />
        );
      case 'plan-setup':
        return (
          <PlanSetupView
            program={program}
            onBack={() => setView({ screen: 'journey' })}
            onActivated={() => {
              // The activated block's program is now the live program
              setProgram(getStoredProgram());
              setView({ screen: 'dashboard' });
              sync();
            }}
          />
        );
      case 'shared-preview': {
        const shared = getPendingSharedWorkout();
        if (!shared) break;
        return (
          <SharedWorkoutView
            shared={shared}
            onStart={() => {
              // One-off session: the shared exercises join the library (so
              // history resolves them) but the program stays untouched.
              const day = acceptSharedWorkout(shared, SHARED_DAY_ID);
              clearPendingShare();
              setSharedDay(day);
              setView({ screen: 'shared-workout' });
              sync();
            }}
            onAddToProgram={() => {
              const nextId = program.reduce((m, d) => Math.max(m, d.id), 0) + 1;
              const day = acceptSharedWorkout(shared, nextId, `Day ${program.length + 1}`);
              clearPendingShare();
              const next = [...program, day];
              setProgram(next);
              saveStoredProgram(next);
              setView({ screen: 'dashboard' });
              sync();
            }}
            onDismiss={() => {
              clearPendingShare();
              setView({ screen: 'dashboard' });
            }}
          />
        );
      }
      case 'shared-workout': {
        if (!sharedDay) break;
        return (
          <WorkoutView
            day={sharedDay}
            program={program}
            onBack={() => setView({ screen: 'dashboard' })}
            onComplete={() => {
              setSharedDay(null);
              setView({ screen: 'dashboard' });
              sync();
            }}
          />
        );
      }
      case 'dashboard':
        break;
    }

    return (
      <>
        <header className="app-header">
          <h1>LiftLog</h1>
        </header>
        <main className="app-main">
          <Dashboard
            program={program}
            onStartWorkout={dayId => setView({ screen: 'workout', dayId })}
            onEditDay={dayId => setView({ screen: 'edit-day', dayId })}
            onViewHistory={() => setView({ screen: 'history' })}
            onViewExercises={() => setView({ screen: 'exercise-list' })}
            onViewMetrics={() => setView({ screen: 'metrics' })}
            onViewSettings={() => setView({ screen: 'settings' })}
            onViewJourney={() => setView({ screen: 'journey' })}
            onPlanSetup={() => setView({ screen: 'plan-setup' })}
          />
        </main>
      </>
    );
  }

  return <div className="app">{renderView()}</div>;
}

export default App;
