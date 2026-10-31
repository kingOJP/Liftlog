import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import type { WorkoutDay } from './data/program';
import { getStoredProgram, saveStoredProgram, removeExerciseFromProgram } from './data/programStore';
import { getLoggedInUser, ensureLocalDataOwner, pullSync, pushSync } from './data/sync';
import type { SyncUser } from './data/sync';
import { ensureJourneyMigrated, ensureWeekAnchor, startPendingActivation, reconcileActiveProgram } from './data/planStore';
import { migrateExerciseIds, ensureSessionGuids, purgeEmptySessions } from './db/database';
import { clearDraftSession } from './data/draftSession';
import type { DraftSession } from './data/draftSession';
import { getSyncStatus, subscribeSyncStatus } from './data/syncStatus';
import { getUpdateReady, subscribeUpdateReady } from './data/appUpdate';
import { isQuickWorkout } from './data/quickWorkout';
import Dashboard from './components/Dashboard';
import WorkoutView from './components/WorkoutView';
import HistoryView from './components/HistoryView';
import DayEditView from './components/DayEditView';
import ExerciseListView from './components/ExerciseListView';
import ExerciseMetaView from './components/ExerciseMetaView';
import MetricsView from './components/MetricsView';
import SettingsView from './components/SettingsView';
import GlossaryView from './components/GlossaryView';
import LoginView from './components/LoginView';
import JourneyView from './components/JourneyView';
import PlanSetupView from './components/PlanSetupView';
import QuickWorkoutView from './components/QuickWorkoutView';
import SharedWorkoutView from './components/SharedWorkoutView';
import Icon from './components/Icon';
import {
  captureShareFromUrl, getPendingSharedWorkout, clearPendingShare,
  acceptSharedWorkout, SHARED_DAY_ID,
} from './data/share';
import './App.css';

type View =
  | { screen: 'dashboard' }
  // The day is SNAPSHOTTED into the view when the workout opens. A background
  // pull can replace the program while the user is mid-set; looking the day
  // up by id on every render would unmount the workout the moment its id
  // vanished. WorkoutView freezes the day too; this keeps it mounted.
  | { screen: 'workout'; day: WorkoutDay }
  | { screen: 'history' }
  | { screen: 'edit-session'; sessionId: number; dayId: number }
  | { screen: 'edit-day'; dayId: number }
  | { screen: 'new-day'; day: WorkoutDay }
  | { screen: 'exercise-list' }
  | { screen: 'exercise-meta'; exerciseId: string; exerciseName: string }
  | { screen: 'metrics' }
  | { screen: 'settings' }
  | { screen: 'glossary' }
  | { screen: 'journey' }
  | { screen: 'plan-setup' }
  | { screen: 'quick-setup' }
  | { screen: 'quick-workout' }
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
  // A quick/one-off workout assembled in QuickWorkoutView (never added to the program)
  const [quickDay, setQuickDay] = useState<WorkoutDay | null>(null);
  // True while a workout is being logged — the background tick must not swap
  // the program underneath it (a pending block waits for the workout to end).
  const workoutOpenRef = useRef(false);
  const workoutOpen = view.screen === 'workout' || view.screen === 'quick-workout' || view.screen === 'shared-workout';
  useEffect(() => { workoutOpenRef.current = workoutOpen; }, [workoutOpen]);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  // A new build took over the service worker. The toast waits until no
  // workout is open — reloading mid-set is the one thing it must never do.
  const updateReady = useSyncExternalStore(subscribeUpdateReady, getUpdateReady, () => false);
  const [updateDismissed, setUpdateDismissed] = useState(false);

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
        // installs here (the interval doubles as its scheduler) — but never
        // while a workout is being logged against the current program.
        const started = workoutOpenRef.current ? false : await startPendingActivation();
        const healed = reconcileActiveProgram();
        if (didPull) ensureWeekAnchor();
        if (didPull || started || healed) setProgram(getStoredProgram());
        // Anything this device still owes the server (a push that failed after
        // a workout, offline edits) goes up now rather than at the next cold start.
        if (started || healed || getSyncStatus().hasUnpushed) pushSync().catch(() => {});
      } catch {
        // reported through syncStatus; the UI shows it, the next tick retries
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

  // Resume an unfinished workout from the draft — a program day by its live
  // definition (or the snapshot, if the program no longer has it), a quick or
  // shared workout from the snapshot the draft carries.
  function handleResumeDraft(draft: DraftSession) {
    const snapshot = draft.day;
    if (draft.origin === 'quick' || (!draft.origin && isQuickWorkout(draft.dayId))) {
      if (!snapshot) { clearDraftSession(); return; }
      setQuickDay(snapshot);
      setView({ screen: 'quick-workout' });
      return;
    }
    if (draft.origin === 'shared' || (!draft.origin && draft.dayId === SHARED_DAY_ID)) {
      if (!snapshot) { clearDraftSession(); return; }
      setSharedDay(snapshot);
      setView({ screen: 'shared-workout' });
      return;
    }
    const day = program.find(d => d.id === draft.dayId) ?? snapshot;
    if (!day) { clearDraftSession(); return; }
    setView({ screen: 'workout', day });
  }

  function handleUpdateDay(updated: WorkoutDay) {
    const exists = program.some(d => d.id === updated.id);
    const next = exists ? program.map(d => (d.id === updated.id ? updated : d)) : [...program, updated];
    setProgram(next);
    saveStoredProgram(next);
    setView({ screen: 'dashboard' });
    sync();
  }

  function nextDayId(): number {
    return program.reduce((m, d) => Math.max(m, d.id), 0) + 1;
  }

  // A day of the user's own — nothing is stored until they save it with at
  // least one exercise.
  function handleAddDay() {
    setView({
      screen: 'new-day',
      day: { id: nextDayId(), label: `Day ${program.length + 1}`, muscleGroups: '', exercises: [] },
    });
  }

  function handleMoveDay(dayId: number, dir: -1 | 1) {
    const idx = program.findIndex(d => d.id === dayId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= program.length) return;
    const next = [...program];
    [next[idx], next[target]] = [next[target], next[idx]];
    setProgram(next);
    saveStoredProgram(next);
    sync();
  }

  function handleDeleteDay(dayId: number) {
    const next = program.filter(d => d.id !== dayId);
    setProgram(next);
    saveStoredProgram(next);
    setView({ screen: 'dashboard' });
    sync();
  }

  // After a quick workout, offer to keep it: the exercises and the sets × reps
  // the lifter actually ran become a program day. The one-off session itself
  // is already saved either way.
  function offerQuickDayAsProgramDay(day: WorkoutDay) {
    if (day.exercises.length === 0) return;
    const keep = window.confirm('Keep this workout as a day in your program? You can rename and edit it afterwards.');
    if (!keep) return;
    const added: WorkoutDay = {
      ...day,
      id: nextDayId(),
      label: `Day ${program.length + 1}`,
      muscleGroups: day.exercises.map(e => e.name).slice(0, 3).join(' / '),
    };
    const next = [...program, added];
    setProgram(next);
    saveStoredProgram(next);
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
        // Keyed by day so resuming a different day's draft from the conflict
        // sheet mounts a fresh view (the day is frozen state inside it).
        return (
          <WorkoutView
            key={`workout-${view.day.id}`}
            day={view.day}
            program={program}
            origin="program"
            onBack={() => setView({ screen: 'dashboard' })}
            onComplete={() => { setView({ screen: 'dashboard' }); sync(); }}
            onResumeDraft={handleResumeDraft}
          />
        );
      }
      case 'edit-session': {
        // A quick or shared workout (negative dayId) or a day the program no
        // longer has: edit it from its own logged exercises. WorkoutView
        // renders every logged exercise the day's design doesn't list.
        const day = findDay(view.dayId) ?? {
          id: view.dayId,
          label: isQuickWorkout(view.dayId) ? 'Quick workout'
            : view.dayId === SHARED_DAY_ID ? 'Shared workout' : `Day ${view.dayId}`,
          muscleGroups: 'Logged exercises',
          exercises: [],
        };
        return (
          <WorkoutView
            key={`edit-${view.sessionId}`}
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
        const idx = program.findIndex(d => d.id === day.id);
        return (
          <DayEditView
            key={`edit-day-${day.id}`}
            day={day}
            canMoveUp={idx > 0}
            canMoveDown={idx < program.length - 1}
            onMove={dir => handleMoveDay(day.id, dir)}
            onDelete={() => handleDeleteDay(day.id)}
            onBack={() => setView({ screen: 'dashboard' })}
            onSave={handleUpdateDay}
          />
        );
      }
      case 'new-day':
        return (
          <DayEditView
            key="new-day"
            day={view.day}
            isNew
            onBack={() => setView({ screen: 'dashboard' })}
            onSave={handleUpdateDay}
          />
        );
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
            onBack={() => setView({ screen: 'settings' })}
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
              // The store write happens outside the updater (an updater runs
              // twice under StrictMode); the saved program is the new state.
              setProgram(removeExerciseFromProgram(exerciseId, program));
              setView({ screen: 'exercise-list' });
              sync();
            }}
          />
        );
      case 'metrics':
        return <MetricsView program={program} onBack={() => setView({ screen: 'dashboard' })} />;
      case 'settings':
        return (
          <SettingsView
            user={user!}
            onBack={() => setView({ screen: 'dashboard' })}
            onSyncNow={async () => {
              try {
                if (await pullSync()) setProgram(getStoredProgram());
                await pushSync();
              } catch (err) {
                console.error(err);
              }
            }}
            onViewExercises={() => setView({ screen: 'exercise-list' })}
            onViewGlossary={() => setView({ screen: 'glossary' })}
          />
        );
      case 'glossary':
        return <GlossaryView onBack={() => setView({ screen: 'settings' })} />;
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
      case 'quick-setup':
        return (
          <QuickWorkoutView
            onBack={() => setView({ screen: 'dashboard' })}
            onStart={day => {
              setQuickDay(day);
              setView({ screen: 'quick-workout' });
            }}
          />
        );
      case 'quick-workout': {
        if (!quickDay) break;
        return (
          <WorkoutView
            key="quick"
            day={quickDay}
            program={program}
            origin="quick"
            onBack={() => { setQuickDay(null); setView({ screen: 'dashboard' }); }}
            onComplete={() => {
              const finished = quickDay;
              setQuickDay(null);
              setView({ screen: 'dashboard' });
              if (finished) offerQuickDayAsProgramDay(finished);
              sync();
            }}
            onResumeDraft={handleResumeDraft}
          />
        );
      }
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
            key="shared"
            day={sharedDay}
            program={program}
            origin="shared"
            onBack={() => setView({ screen: 'dashboard' })}
            onComplete={() => {
              setSharedDay(null);
              setView({ screen: 'dashboard' });
              sync();
            }}
            onResumeDraft={handleResumeDraft}
          />
        );
      }
      case 'dashboard':
        break;
    }

    return (
      <>
        <header className="app-header">
          <h1 className="app-brand">
            <Icon name="logo" size={26} strokeWidth={2.4} className="app-brand-mark" />
            LiftLog
          </h1>
          <button
            type="button"
            className="app-header-action"
            aria-label="Settings"
            onClick={() => setView({ screen: 'settings' })}
          >
            <Icon name="settings" size={20} />
          </button>
        </header>
        <main className="app-main">
          <Dashboard
            program={program}
            onStartWorkout={dayId => {
              const day = findDay(dayId);
              if (day) setView({ screen: 'workout', day });
            }}
            onResumeWorkout={handleResumeDraft}
            onAddDay={handleAddDay}
            onEditDay={dayId => setView({ screen: 'edit-day', dayId })}
            onViewHistory={() => setView({ screen: 'history' })}
            onViewMetrics={() => setView({ screen: 'metrics' })}
            onViewSettings={() => setView({ screen: 'settings' })}
            onViewJourney={() => setView({ screen: 'journey' })}
            onPlanSetup={() => setView({ screen: 'plan-setup' })}
            onQuickWorkout={() => setView({ screen: 'quick-setup' })}
          />
        </main>
      </>
    );
  }

  return (
    <div className="app">
      {syncStatus.authExpired && (
        <div className="auth-banner" role="alert">
          <span>Your sign-in expired — workouts are saved on this phone but not syncing.</span>
          <a className="auth-banner-link" href="/api/auth/google">Sign in again</a>
        </div>
      )}
      {renderView()}
      {updateReady && !updateDismissed && !workoutOpen && (
        <div className="update-toast" role="status">
          <span>A new version of LiftLog is ready.</span>
          <button className="update-toast-btn" onClick={() => window.location.reload()}>Reload</button>
          <button className="update-toast-dismiss" onClick={() => setUpdateDismissed(true)} aria-label="Not now">×</button>
        </div>
      )}
    </div>
  );
}

export default App;
