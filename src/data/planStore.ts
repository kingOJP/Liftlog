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

import { isPlanDoc, mergePlanDocs } from '../../worker/planMerge';
import type { WorkoutDay } from './program';
import { getStoredProgram, saveStoredProgram } from './programStore';
import { getProgramStartValue, saveProgramStart } from './settings';
import { loadTrainingSnapshot } from './analytics';
import type { TrainingSnapshot } from './analytics';
import type { BlockRetrospective, Goal, PhaseKind, TrainingBlock, TrainingPlan, TrainingProfile, PhaseResolver, CoachDecision } from './plan';
import { blockAnchor, currentPhase, defaultTrainingProfile, generatePlanId, goalLabel, nextMonday, toPlanDate, phaseResolverFor } from './plan';
import { computeBlockRetrospective } from './retrospective';
import type { PlanProposal } from './planner';
import type { OneRepMax, StrengthGoal, StrengthState } from './strength';
import { emptyStrengthState } from './strength';

const PLAN_KEY = 'liftlog_plan';

// An approved block that hasn't reached its start date yet. The current block
// keeps running (this week's workouts stay put); the new program installs on
// the pending block's start Monday.
export interface PendingActivation {
  goal: Goal;
  goalNotes?: string;
  block: TrainingBlock; // status 'pending'
  createdAt: number;
}

export interface PlanState {
  version: 1;
  /** every plan, oldest first; at most one with status 'active' */
  plans: TrainingPlan[];
  pendingActivation?: PendingActivation;
  /** the athlete profile (Tier 1/2 onboarding inputs) — rides the same LWW sync */
  profile?: TrainingProfile;
  /** one-rep maxes + 1RM goals (strength.ts) — rides the same LWW sync */
  strength?: StrengthState;
  updatedAt: number;
}

/** True when the document carries anything worth syncing. */
export function planStateHasContent(state: PlanState): boolean {
  return state.plans.length > 0 || state.profile != null
    || (state.strength != null && (state.strength.maxes.length > 0 || state.strength.goals.length > 0));
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

// ── Training profile ──────────────────────────────────────────────────────────

/** The stored profile, or null when the user hasn't onboarded yet. */
export function getTrainingProfile(): TrainingProfile | null {
  return getPlanState().profile ?? null;
}

/** The profile to plan with — stored if present, else sane defaults. */
export function getProfileOrDefault(): TrainingProfile {
  return getPlanState().profile ?? defaultTrainingProfile();
}

export function hasOnboarded(): boolean {
  return getPlanState().profile != null;
}

/**
 * The profile carries its own clock and does NOT bump the document's. Bumping
 * it meant a casual "level up" tap on an offline device outranked a newer
 * block activation made elsewhere: the plans were rejected on merge while the
 * program store still adopted that block's program (audit H4).
 */
export function saveTrainingProfile(profile: TrainingProfile, now = Date.now()): void {
  const state = getPlanState();
  state.profile = { ...profile, updatedAt: now };
  savePlanState(state);
}

// ── Strength records (1RMs + goals) ───────────────────────────────────────────
// One max and one goal per exercise, keyed by exercise id. Stored on the
// journey document so they sync with the plan and clear with it on an account
// switch — a 1RM is as much "the athlete" as the profile is.

export function getStrengthState(): StrengthState {
  return getPlanState().strength ?? emptyStrengthState();
}

export function getOneRepMax(exerciseId: string): OneRepMax | null {
  return getStrengthState().maxes.find(m => m.exerciseId === exerciseId) ?? null;
}

export function getStrengthGoal(exerciseId: string): StrengthGoal | null {
  return getStrengthState().goals.find(g => g.exerciseId === exerciseId) ?? null;
}

function updateStrength(mutate: (s: StrengthState) => void, now: number): void {
  const state = getPlanState();
  const strength = state.strength ?? emptyStrengthState();
  mutate(strength);
  state.strength = strength;
  state.updatedAt = now;
  savePlanState(state);
}

/** Upsert the max for an exercise (replaces any previous record). */
export function saveOneRepMax(max: Omit<OneRepMax, 'updatedAt'>, now = Date.now()): OneRepMax {
  const record: OneRepMax = { ...max, updatedAt: now };
  updateStrength(s => {
    s.maxes = [...s.maxes.filter(m => m.exerciseId !== max.exerciseId), record];
  }, now);
  return record;
}

export function removeOneRepMax(exerciseId: string, now = Date.now()): void {
  updateStrength(s => { s.maxes = s.maxes.filter(m => m.exerciseId !== exerciseId); }, now);
}

/** Upsert the 1RM goal for an exercise. */
export function saveStrengthGoal(exerciseId: string, targetWeight: number, now = Date.now()): StrengthGoal {
  const existing = getStrengthGoal(exerciseId);
  const goal: StrengthGoal = { exerciseId, targetWeight, createdAt: existing?.createdAt ?? now };
  updateStrength(s => {
    s.goals = [...s.goals.filter(g => g.exerciseId !== exerciseId), goal];
  }, now);
  return goal;
}

export function removeStrengthGoal(exerciseId: string, now = Date.now()): void {
  updateStrength(s => { s.goals = s.goals.filter(g => g.exerciseId !== exerciseId); }, now);
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

/**
 * SAFEGUARD — self-heal the live program from the active block.
 *
 * The active block's program IS the live program (`liftlog_program`);
 * activation copies it there. If the live program is ever empty while the
 * active block still holds its workouts — a bad sync, a botched migration, an
 * app update gone wrong — restore it from the block, which is the source of
 * truth for what the user is training. This guarantees that having an active
 * training block can't silently leave you with no workouts. It never fires
 * when the live program is non-empty (so it can't undo real edits) or when the
 * block itself has no program (nothing to restore). Returns true if it healed.
 */
export function reconcileActiveProgram(): boolean {
  const info = getActiveBlockInfo();
  if (!info || info.block.program.length === 0) return false;
  if (getStoredProgram().length > 0) return false;
  saveStoredProgram(info.block.program);
  return true;
}

/** The phase governing this week's training, or null when nothing is scheduled. */
export function getActivePhase(now = Date.now()): PhaseKind | null {
  const info = getActiveBlockInfo();
  return info ? currentPhase(info.block, now) : null;
}

/**
 * The planned phase for ANY past moment — what progress, insights and the
 * coach overlay use to keep planned easy weeks out of trend verdicts.
 */
export function getPhaseResolver(): PhaseResolver {
  return phaseResolverFor(getPlanState().plans);
}

/** The most recently completed block, if any. */
export function getLatestCompletedBlock(): TrainingBlock | null {
  let best: TrainingBlock | null = null;
  for (const plan of getPlanState().plans) {
    for (const block of plan.blocks) {
      if (block.status === 'completed' && block.completedAt != null) {
        if (!best || block.completedAt > (best.completedAt ?? 0)) best = block;
      }
    }
  }
  return best;
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
    block.completedBy = 'user';
    if (retro) block.retrospective = retro;
  }
  if (alsoPlan) {
    plan.status = 'completed';
    plan.completedAt = now;
  }
  state.updatedAt = now;
  savePlanState(state);
  // Between blocks, weeks count from when the last block ended — the anchor
  // is managed automatically (no user-facing setting).
  if (block) saveProgramStart(toPlanDate(new Date(now)));
}

/**
 * Keep the (device-local) week-numbering anchor consistent with the (synced)
 * journey document: an active block anchors weeks at its start; between
 * blocks, at the last block's end. Fixes cross-device drift — activation only
 * ran saveProgramStart on the activating device — and replaces the manual
 * "training block start" setting. Returns true when the anchor moved.
 */
export function ensureWeekAnchor(): boolean {
  const state = getPlanState();
  const active = state.plans
    .find(p => p.status === 'active')?.blocks.find(b => b.status === 'active');

  let desired: string | null = null;
  if (active) {
    desired = active.startDate;
  } else {
    let lastEnd = 0;
    for (const plan of state.plans) {
      for (const block of plan.blocks) {
        if (block.status === 'completed' && (block.completedAt ?? 0) > lastEnd) {
          lastEnd = block.completedAt!;
        }
      }
    }
    if (lastEnd > 0) desired = toPlanDate(new Date(lastEnd));
  }

  if (!desired || getProgramStartValue() === desired) return false;
  saveProgramStart(desired);
  return true;
}

/**
 * Activate an approved proposal.
 *
 * If the block starts now (or nothing is currently running), it commits
 * immediately: the running block is closed out, the block joins the active
 * plan (same goal) or starts a new one (goal transition), and its program
 * becomes the live program with week numbering re-anchored to its start.
 *
 * If the block is scheduled for a future Monday while a block is still
 * running, it is stored as a *pending activation* instead — the current
 * week's workouts stay untouched, and startPendingActivation() commits it
 * once the start date arrives (the outgoing block's retrospective is
 * computed then, so it includes the final week of training).
 */
export function activateProposal(
  proposal: PlanProposal,
  outgoingRetro: BlockRetrospective | null = null,
  now = Date.now(),
): { started: boolean; plan: TrainingPlan | null } {
  const state = getPlanState();
  // Re-planning before a pending block started replaces it outright
  delete state.pendingActivation;

  const block: TrainingBlock = {
    id: generatePlanId(),
    name: '', // assigned at commit (sequence number depends on commit order)
    focus: proposal.input.goal,
    startDate: proposal.input.startDate,
    phases: proposal.phases,
    program: proposal.days,
    intent: proposal.intent,
    progression: proposal.progression,
    status: 'pending',
    activatedAt: now,
    experience: proposal.input.experience,
  };
  const pending: PendingActivation = {
    goal: proposal.input.goal,
    ...(proposal.input.notes.trim() ? { goalNotes: proposal.input.notes.trim() } : {}),
    block,
    createdAt: now,
  };

  // One rule, one direction: a block whose start Monday is still ahead waits
  // for it, whether or not something is running. Installing a future-dated
  // block immediately (as happened when nothing was running) produced an
  // active block weeks before its own start, with no phase and every
  // phase-gated day visible.
  const startsInFuture = blockAnchor(block).getTime() > now;
  if (startsInFuture) {
    state.pendingActivation = pending;
    state.updatedAt = now;
    savePlanState(state);
    return { started: false, plan: null };
  }

  const plan = commitActivation(state, pending, outgoingRetro, now);
  return { started: true, plan };
}

// Commit a (possibly deferred) activation: close out the running block, slot
// the new block into the right plan, install its program, anchor the weeks.
function commitActivation(
  state: PlanState,
  pending: PendingActivation,
  outgoingRetro: BlockRetrospective | null,
  now: number,
): TrainingPlan {
  const active = state.plans.find(p => p.status === 'active');
  const block = pending.block;

  if (active) {
    const running = active.blocks.find(b => b.status === 'active');
    if (running) {
      running.status = 'completed';
      running.completedAt = now;
      running.completedBy = 'activation';
      if (outgoingRetro) running.retrospective = outgoingRetro;
      // Remember what this activation displaced, so "finish the week on the
      // previous workouts" can undo exactly this and nothing else — and can
      // restore the LIVE program (with any mid-block edits), not the replaced
      // block's activation-time snapshot.
      block.replacedBlockId = running.id;
      block.replacedProgram = getStoredProgram();
    }
  }

  const continuing = active != null && active.goal === pending.goal;
  let plan: TrainingPlan;
  if (continuing) {
    plan = active!;
    if (pending.goalNotes) plan.goalNotes = pending.goalNotes;
  } else {
    if (active) {
      active.status = 'completed';
      active.completedAt = now;
    }
    plan = {
      id: generatePlanId(),
      goal: pending.goal,
      ...(pending.goalNotes ? { goalNotes: pending.goalNotes } : {}),
      origin: 'planned',
      status: 'active',
      createdAt: now,
      blocks: [],
    };
    state.plans.push(plan);
  }

  const seq = state.plans.reduce((n, p) => n + p.blocks.length, 0) + 1;
  block.name = `Block ${seq} · ${goalLabel(pending.goal)}`;
  block.status = 'active';
  plan.blocks.push(block);

  state.updatedAt = now;
  savePlanState(state);

  // The block's program becomes the live program; weeks count from its start.
  saveStoredProgram(block.program);
  saveProgramStart(block.startDate);

  return plan;
}

export function getPendingActivation(): PendingActivation | null {
  return getPlanState().pendingActivation ?? null;
}

/**
 * Commit the pending activation once its start date arrives (or immediately
 * with `force`). Computes the outgoing block's retrospective from everything
 * logged — including the final week the deferral protected. Returns true when
 * the program changed (callers refresh UI and sync).
 */
export async function startPendingActivation(
  now = Date.now(),
  opts: { force?: boolean; loadSnapshot?: () => Promise<TrainingSnapshot> } = {},
): Promise<boolean> {
  const state = getPlanState();
  const pending = state.pendingActivation;
  if (!pending) return false;
  if (!opts.force && blockAnchor(pending.block).getTime() > now) return false;

  let outgoingRetro: BlockRetrospective | null = null;
  const running = state.plans
    .find(p => p.status === 'active')?.blocks.find(b => b.status === 'active');
  if (running) {
    const snapshot = await (opts.loadSnapshot ?? loadTrainingSnapshot)();
    if (snapshot.sessions.length > 0) {
      outgoingRetro = computeBlockRetrospective(running, snapshot, now);
    }
  }

  delete state.pendingActivation;
  commitActivation(state, pending, outgoingRetro, now);
  return true;
}

/**
 * Drop a block that was approved but hasn't started yet. Nothing was
 * installed for it (the live program and the running block are untouched),
 * so cancelling is just forgetting it — the user can plan again from scratch.
 * Bumps the document clock so the cancellation wins over a stale copy on
 * another device. Returns false when nothing was queued.
 */
export function cancelPendingActivation(now = Date.now()): boolean {
  const state = getPlanState();
  if (!state.pendingActivation) return false;
  delete state.pendingActivation;
  state.updatedAt = now;
  savePlanState(state);
  return true;
}

/**
 * The goal the user is currently training toward, or null when they have no
 * plan at all. Prescription needs to tell "no plan" apart from "general goal" —
 * dosing an ad-hoc lift as if a plan existed is how invented rep ranges creep
 * back in. Analytics that only need *a* goal to weight signals use
 * getTrainingGoal() below.
 */
export function getPlannedGoal(): Goal | null {
  const state = getPlanState();
  const active = state.plans.find(p => p.status === 'active');
  return (active && planHasChosenGoal(active) ? active.goal : null)
    ?? state.pendingActivation?.goal
    ?? null;
}

/**
 * Did the user ever CHOOSE this plan's goal? A migrated "Foundation" plan was
 * created by the app around pre-journey history (or around a quick workout
 * the user logged once) with a goal nobody picked. Until a wizard-made block
 * joins it, its goal is not a prescription source: a lifter running their own
 * 5×5 as quick workouts must not be dosed 2×8–12 "for this block's goal".
 * This rule applies at read time, so existing accounts are covered without
 * a data migration; a migrated plan that later received a wizard block keeps
 * its goal, because that block's activation was the choice.
 */
export function planHasChosenGoal(plan: TrainingPlan): boolean {
  return plan.origin === 'planned' || plan.blocks.some(b => !b.openEnded);
}

/** The goal the user is currently training toward (weights the progress engine). */
export function getTrainingGoal(): Goal {
  return getPlannedGoal() ?? 'general';
}

/**
 * The block the active one displaced at activation — only if that activation
 * is what closed it. A block the user wrapped up deliberately is never
 * reactivated by the undo path, and nothing is offered while another block is
 * already queued (the undo would silently overwrite it).
 */
function undoableActivation(state: PlanState): { plan: TrainingPlan; block: TrainingBlock } | null {
  if (state.pendingActivation) return null;
  const active = state.plans.find(p => p.status === 'active')?.blocks.find(b => b.status === 'active');
  if (!active || active.openEnded || !active.replacedBlockId) return null;
  for (const plan of state.plans) {
    const block = plan.blocks.find(b => b.id === active.replacedBlockId);
    if (block) {
      return block.status === 'completed' && block.completedBy === 'activation' ? { plan, block } : null;
    }
  }
  return null;
}

/**
 * True when there's a started block that could be postponed back to the
 * program that preceded it — i.e. the user activated a block mid-week and can
 * still finish the week on their previous workouts.
 */
export function canDeferActiveBlock(): boolean {
  return undoableActivation(getPlanState()) != null;
}

/**
 * Undo a premature activation: restore the previous block's program as the
 * live program (so this week finishes on the old workouts) and reschedule the
 * just-activated block to next Monday as a pending activation. The faithful
 * inverse of commitActivation. Returns false when there's nothing to restore.
 */
export function deferActiveBlockToNextWeek(now = Date.now()): boolean {
  const state = getPlanState();
  const activePlan = state.plans.find(p => p.status === 'active');
  const activeBlock = activePlan?.blocks.find(b => b.status === 'active');
  if (!activePlan || !activeBlock || activeBlock.openEnded) return false;

  const prev = undoableActivation(state);
  if (!prev) return false;
  const restoreProgram = activeBlock.replacedProgram ?? prev.block.program;

  // Reactivate the previous block (and its plan, if a goal transition had
  // completed it) — clearing the retrospective activation auto-generated.
  prev.block.status = 'active';
  delete prev.block.completedAt;
  delete prev.block.completedBy;
  delete prev.block.retrospective;
  prev.plan.status = 'active';
  delete prev.plan.completedAt;

  // Pull the just-activated block out of its plan; drop a now-empty plan that
  // activation had freshly created for a goal transition.
  activePlan.blocks = activePlan.blocks.filter(b => b.id !== activeBlock.id);
  if (activePlan.id !== prev.plan.id && activePlan.blocks.length === 0) {
    state.plans = state.plans.filter(p => p.id !== activePlan.id);
  }

  // Queue it for next Monday instead.
  activeBlock.status = 'pending';
  activeBlock.startDate = nextMonday(new Date(now));
  delete activeBlock.replacedBlockId;
  delete activeBlock.replacedProgram;
  state.pendingActivation = {
    goal: activeBlock.focus,
    ...(activePlan.goalNotes ? { goalNotes: activePlan.goalNotes } : {}),
    block: activeBlock,
    createdAt: now,
  };

  // Restore the live program as it was (edits included) + the week anchor.
  saveStoredProgram(restoreProgram);
  saveProgramStart(prev.block.startDate);

  state.updatedAt = now;
  savePlanState(state);
  return true;
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
  // The goal here is a placeholder for analytics weighting only — the user
  // never chose it, and planHasChosenGoal() keeps it out of prescription.
  const plan: TrainingPlan = {
    id: generatePlanId(),
    goal: 'general',
    origin: 'migrated',
    status: 'active',
    createdAt: now,
    blocks: [{
      id: generatePlanId(),
      name: 'Foundation training',
      focus: 'general',
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

  // Keep whatever else the document already holds (an onboarding profile
  // saved before the first plan, a queued activation) — this used to write a
  // fresh document and drop both.
  savePlanState({ ...state, plans: [plan], updatedAt: now });
  return true;
}

// ── Coach decisions ───────────────────────────────────────────────────────────
// The in-block coach's set adjustments are a pure overlay; this is its memory.
// Stored on the active block so it syncs with the journey and resets per block.

/** Decisions recorded for the active block (empty when there is none). */
export function getCoachDecisions(): CoachDecision[] {
  return getActiveBlockInfo()?.block.coachDecisions ?? [];
}

/** Accept or decline one adjustment for the rest of the block. */
export function recordCoachDecision(key: string, accepted: boolean, now = Date.now()): void {
  const state = getPlanState();
  const block = state.plans.find(p => p.status === 'active')?.blocks.find(b => b.status === 'active');
  if (!block) return;
  const decisions = (block.coachDecisions ?? []).filter(d => d.key !== key);
  decisions.push({ key, accepted, at: now });
  block.coachDecisions = decisions;
  state.updatedAt = now;
  savePlanState(state);
}

// ── Sync merge ────────────────────────────────────────────────────────────────
// Whole-document last-write-wins, same as the program. Returns true when the
// server copy replaced local state (caller refreshes UI).

// The same merge the worker applies on push (worker/planMerge.ts): the newer
// plans document wins, the newer profile wins, independently.
export function mergeServerPlanState(server: unknown): boolean {
  if (!isPlanDoc(server)) return false;
  const { doc, changed } = mergePlanDocs<PlanState>(getPlanState(), server as unknown as PlanState);
  if (!changed) return false;
  savePlanState(doc);
  return true;
}
