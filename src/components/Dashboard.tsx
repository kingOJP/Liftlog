import { useState, useEffect, useRef } from 'react';
import type { WorkoutDay } from '../data/program';
import { getWeekNumber, getWeekDateRange } from '../data/program';
import { getCompletedSessionsForWeek } from '../db/database';
import { exportData, importData } from '../data/backup';
import DayCard from './DayCard';
import './Dashboard.css';

interface Props {
  program: WorkoutDay[];
  onStartWorkout: (dayId: number) => void;
  onEditDay: (dayId: number) => void;
  onViewHistory: () => void;
  onViewExercises: () => void;
}

export default function Dashboard({ program, onStartWorkout, onEditDay, onViewHistory, onViewExercises }: Props) {
  const weekNumber = getWeekNumber();
  const [completedDayIds, setCompletedDayIds] = useState<number[]>([]);
  const [dataStatus, setDataStatus] = useState<'idle' | 'exporting' | 'importing' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCompletedSessionsForWeek(weekNumber).then(sessions => {
      setCompletedDayIds(sessions.map(s => s.dayId));
    });
  }, [weekNumber]);

  async function handleExport() {
    setDataStatus('exporting');
    try {
      await exportData();
      setDataStatus('done');
    } catch {
      setDataStatus('error');
      setErrorMsg('Export failed.');
    } finally {
      setTimeout(() => setDataStatus('idle'), 2500);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    if (!file) return;

    const confirmed = window.confirm(
      'Importing will replace all current data (history, program, exercise metadata). Continue?'
    );
    if (!confirmed) return;

    setDataStatus('importing');
    try {
      await importData(file);
      setDataStatus('done');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setDataStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Import failed.');
      setTimeout(() => setDataStatus('idle'), 3000);
    }
  }

  const busy = dataStatus === 'exporting' || dataStatus === 'importing';

  return (
    <div className="dashboard">
      <div className="week-header">
        <span className="week-label">{getWeekDateRange()}</span>
        <span className="week-progress">{completedDayIds.length} of 4 done</span>
      </div>
      <div className="day-list">
        {program.map(day => (
          <DayCard
            key={day.id}
            day={day}
            done={completedDayIds.includes(day.id)}
            onClick={() => onStartWorkout(day.id)}
            onEdit={() => onEditDay(day.id)}
          />
        ))}
      </div>
      <button className="history-btn" onClick={onViewHistory}>
        View History
      </button>
      <button className="history-btn" onClick={onViewExercises}>
        Exercise List
      </button>

      <div className="data-row">
        <button className="data-btn" onClick={handleExport} disabled={busy}>
          {dataStatus === 'exporting' ? 'Exporting…' : dataStatus === 'done' ? 'Exported!' : 'Export Data'}
        </button>
        <button className="data-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          {dataStatus === 'importing' ? 'Importing…' : 'Import Data'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      {dataStatus === 'error' && (
        <p className="data-error">{errorMsg}</p>
      )}
    </div>
  );
}
