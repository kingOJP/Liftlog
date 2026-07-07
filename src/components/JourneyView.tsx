import { useEffect, useMemo, useState } from 'react';
import { loadTrainingSnapshot } from '../data/analytics';
import type { TrainingSnapshot } from '../data/analytics';
import {
  PHASE_INFO, blockEndTs, blockEnded, blockWeekIndex, currentPhase, goalLabel,
} from '../data/plan';
import type { BlockRetrospective, TrainingBlock, TrainingPlan } from '../data/plan';
import { completeActiveBlock, getPlanState } from '../data/planStore';
import { computeBlockRetrospective } from '../data/retrospective';
import './JourneyView.css';

interface Props {
  onBack: () => void;
  onPlanNew: () => void;
  /** called after any stored change (so the app can push a sync) */
  onChanged: () => void;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function blockDateRange(block: TrainingBlock): string {
  const start = new Date(`${block.startDate}T00:00:00`).getTime();
  const end = block.status === 'completed'
    ? (block.retrospective?.to ?? block.completedAt ?? null)
    : blockEndTs(block);
  return end ? `${fmtDate(start)} – ${fmtDate(end)}` : `since ${fmtDate(start)}`;
}

function Retro({ retro }: { retro: BlockRetrospective }) {
  const gains = retro.strength.filter(s => s.changePct > 0).slice(0, 3);
  return (
    <div className="retro">
      <div className="retro-stats">
        <div className="retro-stat">
          <span className="retro-stat-value">{retro.sessionsCompleted}</span>
          <span className="retro-stat-label">workouts</span>
        </div>
        {retro.adherencePct != null && (
          <div className="retro-stat">
            <span className="retro-stat-value">{retro.adherencePct}%</span>
            <span className="retro-stat-label">adherence</span>
          </div>
        )}
        {retro.avgSessionMinutes != null && (
          <div className="retro-stat">
            <span className="retro-stat-value">{retro.avgSessionMinutes}m</span>
            <span className="retro-stat-label">avg session</span>
          </div>
        )}
      </div>
      {retro.summary.map((line, i) => (
        <p className="retro-line" key={i}>{line}</p>
      ))}
      {gains.length > 0 && (
        <div className="retro-lifts">
          {gains.map(g => (
            <div className="retro-lift" key={g.exerciseId}>
              <span className="retro-lift-name">{g.name}</span>
              <span className="retro-lift-change">+{g.changePct.toFixed(1)}% e1RM</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function JourneyView({ onBack, onPlanNew, onChanged }: Props) {
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<TrainingSnapshot | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [justWrapped, setJustWrapped] = useState<BlockRetrospective | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTrainingSnapshot().then(s => { if (!cancelled) setSnapshot(s); });
    return () => { cancelled = true; };
  }, []);

  const state = useMemo(() => getPlanState(), [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const activePlan = state.plans.find(p => p.status === 'active') ?? null;
  const activeBlock = activePlan?.blocks.find(b => b.status === 'active') ?? null;

  const completedBlocks: { plan: TrainingPlan; block: TrainingBlock }[] = state.plans
    .flatMap(plan => plan.blocks.filter(b => b.status === 'completed').map(block => ({ plan, block })))
    .sort((a, b) => (b.block.completedAt ?? 0) - (a.block.completedAt ?? 0));

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function wrapUpBlock() {
    if (!activeBlock || !snapshot) return;
    const ended = blockEnded(activeBlock);
    if (!ended && !window.confirm('End this block early? The coach will review it and you can plan the next one.')) return;
    const retro = computeBlockRetrospective(activeBlock, snapshot);
    completeActiveBlock(retro);
    setJustWrapped(retro);
    setRefresh(r => r + 1);
    onChanged();
  }

  const ended = activeBlock ? blockEnded(activeBlock) : false;
  const phase = activeBlock ? currentPhase(activeBlock) : null;
  const week = activeBlock ? Math.max(0, blockWeekIndex(activeBlock)) + 1 : 0;

  return (
    <div className="journey-view">
      <header className="journey-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">&#8592;</button>
        <span className="journey-title">Training Journey</span>
      </header>

      <div className="journey-body">
        {justWrapped && (
          <section className="journey-section journey-section--accent">
            <span className="journey-label">Block review</span>
            <Retro retro={justWrapped} />
            <button className="journey-primary-btn" onClick={onPlanNew}>
              Plan the next block
            </button>
          </section>
        )}

        {activePlan && activeBlock && !justWrapped ? (
          <section className="journey-section">
            <span className="journey-label">{goalLabel(activePlan.goal)} · active block</span>
            <div className="journey-block-name">{activeBlock.name}</div>
            <div className="journey-block-dates">{blockDateRange(activeBlock)}</div>

            {activeBlock.openEnded ? (
              <p className="journey-hint">
                Open-ended training — week {week}. Plan your first structured block to get
                phased progression, scheduled deloads and end-of-block reviews.
              </p>
            ) : (
              <>
                <div className="journey-week-row">
                  {activeBlock.phases.map((p, i) => (
                    <div
                      className={`journey-week journey-week--${p}${i === week - 1 && !ended ? ' journey-week--now' : ''}`}
                      key={i}
                    >
                      <span className="journey-week-num">W{i + 1}</span>
                      <span className="journey-week-phase">{PHASE_INFO[p].label}</span>
                    </div>
                  ))}
                </div>
                {phase && !ended && (
                  <p className="journey-hint">{PHASE_INFO[phase].blurb}.</p>
                )}
              </>
            )}

            <div className="journey-intent">
              <span className="journey-intent-label">Coaching intent</span>
              <p>{activeBlock.intent}</p>
              <span className="journey-intent-label">Progression</span>
              <p>{activeBlock.progression}</p>
              {activePlan.goalNotes && (
                <>
                  <span className="journey-intent-label">Your notes</span>
                  <p>{activePlan.goalNotes}</p>
                </>
              )}
            </div>

            {ended ? (
              <button className="journey-primary-btn" onClick={wrapUpBlock} disabled={!snapshot}>
                Block complete — review it
              </button>
            ) : (
              <div className="journey-actions">
                <button className="journey-secondary-btn" onClick={onPlanNew}>
                  Plan next block
                </button>
                {!activeBlock.openEnded && (
                  <button className="journey-secondary-btn journey-secondary-btn--muted" onClick={wrapUpBlock} disabled={!snapshot}>
                    End early &amp; review
                  </button>
                )}
                {activeBlock.openEnded && (
                  <button className="journey-primary-btn" onClick={onPlanNew}>
                    Plan my first block
                  </button>
                )}
              </div>
            )}
          </section>
        ) : !justWrapped && (
          <section className="journey-section">
            <span className="journey-label">No active block</span>
            <p className="journey-hint">
              {state.plans.length === 0
                ? 'Tell the coach your goal and it designs a complete training plan around your history — you review and adjust everything before it starts.'
                : 'Your last block is wrapped up. Everything it taught the coach feeds the next one.'}
            </p>
            <button className="journey-primary-btn" onClick={onPlanNew}>
              {state.plans.length === 0 ? 'Create my training plan' : 'Plan the next block'}
            </button>
          </section>
        )}

        {completedBlocks.length > 0 && (
          <section className="journey-section">
            <span className="journey-label">Completed blocks</span>
            <div className="journey-past-list">
              {completedBlocks.map(({ plan, block }) => (
                <div className="journey-past" key={block.id}>
                  <button className="journey-past-head" onClick={() => toggle(block.id)}>
                    <div className="journey-past-title">
                      <span className="journey-past-name">{block.name}</span>
                      <span className="journey-past-dates">{goalLabel(plan.goal)} · {blockDateRange(block)}</span>
                    </div>
                    <span className="journey-past-chevron">{expanded.has(block.id) ? '▾' : '▸'}</span>
                  </button>
                  {expanded.has(block.id) && (
                    block.retrospective
                      ? <Retro retro={block.retrospective} />
                      : <p className="journey-hint">No review was recorded for this block.</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
