// Persistence + lifecycle for the training journey (localStorage, synced).
//
// The whole journey is one document: every plan the user has ever run, at
// most one active. It syncs like the program does — last-write-wins on the
// document's updatedAt — which is the right tradeoff for a single-user
// journal edited from one device at a time (the merge-sensitive data,
// workout sessions, has its own per-document merge in sync v2).
//
// Activation is the only place the journey touches the rest of the app:
// the new block's program becomes the live program (liftlog_program) and the
// block's start date becomes the week-numbering anchor. Everything else —
// coach, recommendations, metrics — keeps reading (program, history) and
// never needs to know blocks exist.

import type { WorkoutDay } from './program';
import { getStoredProgram, saveStoredProgram } from './programStore';
import { getProgramStartValue, saveProgramStart } from './settings';
import { loadTrainingSnapshot } from './analytics';
import type { BlockRetrospective, PhaseKind, TrainingBlock, TrainingPlan } from './plan';
import { currentPhase, generatePlanId, goalLabel, toPlanDate } from './plan';
import type { PlanProposal } from './planner';

const PLAN_KEY = 'liftlog_plan';

export interface PlanState {
  version: 1;
  /** every plan, oldest first; at most one with status 'active' */
  plans: TrainingPlan[];
  updatedAt: number;
}

// Always a fresh object — callers (activateProposal etc.) mutate the returned
// document before saving it back.
function emptyState(): PlanState {
  return { version: 1, plans: [], updatedAt: 0 };
}

export function getPlanState(): PlanState {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PlanState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.plans)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function savePlanState(state: PlanState): void {
  localStorage.setItem(PLAN_KEY, JSON.stringify(state));
}

export function clearPlanState(): void {
  localStorage.removeItem(PLAN_KEY);
}

// ── Readers ───────────────────────────────────────────────────────────────────

export function getActivePlan(): TrainingPlan | null {
  return getPlanState().plans.find(p => p.status === 'active') ?? null;
}

export function getActiveBlockInfo(): { plan: TrainingPlan; block: TrainingBlock } | null {
  const plan = getActivePlan();
  const block = plan?.blocks.find(b => b.status === 'active');
  return plan && block ? { plan, block } : null;
}

/** The phase governing this week's training, or null when nothing is scheduled. */
export function getActivePhase(now = Date.now()): PhaseKind | null {
  const info = getActiveBlockInfo();
  return info ? currentPhase(info.block, now) : null;
}

/** Newest completed block's retrospective — the planner's primary input. */
export function getLatestRetrospective(): BlockRetrospective | null {
  let best: { at: number; retro: BlockRetrospective } | null = null;
  for (const plan of getPlanState().plans) {
    for (const block of plan.blocks) {
      if (block.status === 'completed' && block.retrospective && block.completedAt != null) {
        if (!best || block.completedAt > best.at) best = { at: block.completedAt, retro: block.retrospective };
      }
    }
  }
  return best?.retro ?? null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Close out the active block (if any) with its retrospective. The plan stays
 * active — it may receive another block — unless `alsoPlan` is set.
 */
export function completeActiveBlock(
  retro: BlockRetrospective | null,
  now = Date.now(),
  alsoPlan = false,
): void {
  const state = getPlanState();
  const plan = state.plans.find(p => p.status === 'active');
  if (!plan) return;
  const block = plan.blocks.find(b => b.status === 'active');
  if (block) {
    block.status = 'completed';
    block.completedAt = now;
    if (retro) block.retrospective = retro;
  }
  if (alsoPlan) {
    plan.status = 'completed';
    plan.completedAt = now;
  }
  state.updatedAt = now;
  savePlanState(state);
}

/**
 * Activate an approved proposal: close out whatever is running, then either
 * append a block to the active plan (same goal — the journey continues) or
 * complete it and start a new plan (goal transition). Writes the block's
 * program as the live program and re-anchors week numbering to its start.
 */
export function activateProposal(
  proposal: PlanProposal,
  outgoingRetro: BlockRetrospective | null = null,
  now = Date.now(),
): TrainingPlan {
  const state = getPlanState();
  const active = state.plans.find(p => p.status === 'active');

  // Close the running block under whichever plan owns it
  if (active) {
    const block = active.blocks.find(b => b.status === 'active');
    if (block) {
      block.status = 'completed';
      block.completedAt = now;
      if (outgoingRetro) block.retrospective = outgoingRetro;
    }
  }

  const continuing = active != null && active.goal === proposal.input.goal;
  let plan: TrainingPlan;
  if (continuing) {
    plan = active!;
    if (proposal.input.notes.trim()) plan.goalNotes = proposal.input.notes.trim();
  } else {
    if (active) {
      active.status = 'completed';
      active.completedAt = now;
    }
    plan = {
      id: generatePlanId(),
      goal: proposal.input.goal,
      ...(proposal.input.notes.trim() ? { goalNotes: proposal.input.notes.trim() } : {}),
      origin: 'planned',
      status: 'active',
      createdAt: now,
      blocks: [],
    };
    state.plans.push(plan);
  }

  const seq = state.plans.reduce((n, p) => n + p.blocks.length, 0) + 1;
  const block: TrainingBlock = {
    id: generatePlanId(),
    name: `Block ${seq} · ${goalLabel(proposal.input.goal)}`,
    focus: proposal.input.goal,
    startDate: proposal.input.startDate,
    phases: proposal.phases,
    program: proposal.days,
    intent: proposal.intent,
    progression: proposal.progression,
    status: 'active',
    activatedAt: now,
  };
  plan.blocks.push(block);

  state.updatedAt = now;
  savePlanState(state);

  // The block's program becomes the live program; weeks count from its start.
  saveStoredProgram(proposal.days);
  saveProgramStart(proposal.input.startDate);

  return plan;
}

// ── Migration of pre-journey training ─────────────────────────────────────────
// Existing users have a program and a history but no plan. Wrap them in a
// "Foundation" plan with one open-ended block so the journey owns all of it:
// past workouts count toward retrospectives and the first real planning cycle
// starts from everything the user has already done — not from zero.

export async function ensureJourneyMigrated(): Promise<boolean> {
  const state = getPlanState();
  if (state.plans.length > 0) return false;

  const snapshot = await loadTrainingSnapshot();
  if (snapshot.sessions.length === 0) return false; // fresh user — they'll plan, not migrate

  const now = Date.now();
  const oldest = Math.min(...snapshot.sessions.map(s => s.completedAt ?? s.startedAt));
  // Anchor the foundation block where the history actually starts, not at the
  // (possibly later) configured program start.
  const configured = getProgramStartValue();
  const startDate = oldest < new Date(`${configured}T00:00:00`).getTime()
    ? toPlanDate(new Date(oldest))
    : configured;

  const program: WorkoutDay[] = getStoredProgram();
  const plan: TrainingPlan = {
    id: generatePlanId(),
    goal: 'hypertrophy',
    origin: 'migrated',
    status: 'active',
    createdAt: now,
    blocks: [{
      id: generatePlanId(),
      name: 'Foundation training',
      focus: 'hypertrophy',
      startDate,
      phases: [],
      openEnded: true,
      program,
      intent: 'Your training from before the journey existed — it now counts as your foundation block, and everything you logged feeds the first planned block.',
      progression: 'Double progression with reactive deloads, exactly as you\'ve been training.',
      status: 'active',
      activatedAt: now,
    }],
  };

  savePlanState({ version: 1, plans: [plan], updatedAt: now });
  return true;
}

// ── Sync merge ────────────────────────────────────────────────────────────────
// Whole-document last-write-wins, same as the program. Returns true when the
// server copy replaced local state (caller refreshes UI).

export function mergeServerPlanState(server: unknown): boolean {
  if (server == null || typeof server !== 'object') return false;
  const doc = server as PlanState;
  if (doc.version !== 1 || !Array.isArray(doc.plans) || typeof doc.updatedAt !== 'number') return false;
  if (doc.updatedAt <= getPlanState().updatedAt) return false;
  savePlanState(doc);
  return true;
}
