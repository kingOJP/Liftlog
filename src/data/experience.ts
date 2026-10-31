// Experience inference — the profile that sharpens itself.
//
// A user self-reports an experience level at onboarding, but self-reports are
// noisy: beginners undersell, some oversell. So the coach keeps watching. This
// module reads the training history and infers a level from what the athlete
// actually does — training age, consistency, and whether they're handling
// harder movements — then the planner uses the *higher* of self-reported and
// inferred (experience only ratchets up; nobody gets demoted for a light week).
//
// The classic case, in the user's words: "I put beginner but I'm deadlifting
// consistently — bump me to intermediate." Consistently training an advanced
// lift is the fast path; sheer accumulated consistency is the slow one.
//
// Pure function of a TrainingSnapshot, like every other engine in data/.

import type { TrainingSnapshot } from './analytics';
import { sessionTimestamp } from './analytics';
import { exercisePointSeries } from './progress';
import { difficultyFor, hasCatalogDifficulty } from './exercises';
import { DIFFICULTY_RANK } from './exercises';
import type { ExperienceLevel, TrainingProfile } from './plan';
import { experienceLabel } from './plan';

const WEEK_MS = 7 * 86_400_000;

// A lift counts as "consistently trained" once it has this many sessions —
// enough that the athlete clearly owns the movement, not just tried it once.
const CONSISTENT_SESSIONS = 3;

export interface ExperienceInference {
  level: ExperienceLevel;
  sessions: number;
  weeks: number;
  /** advanced-tier lifts trained in >= CONSISTENT_SESSIONS sessions */
  masteredAdvanced: number;
  rationale: string;
}

export function inferExperience(snapshot: TrainingSnapshot, now = Date.now()): ExperienceInference {
  const sessions = snapshot.sessions.length;
  if (sessions === 0) {
    return { level: 'beginner', sessions: 0, weeks: 0, masteredAdvanced: 0, rationale: 'No training logged yet.' };
  }

  const timestamps = snapshot.sessions.map(sessionTimestamp);
  const weeks = Math.max(1, Math.round((now - Math.min(...timestamps)) / WEEK_MS));

  // Per-exercise session counts → consistency by difficulty tier. Only ids the
  // catalog has classified count: a custom exercise defaults to intermediate
  // for selection, but that default is not evidence about the athlete.
  let masteredAdvanced = 0;
  for (const [id, points] of exercisePointSeries(snapshot)) {
    if (points.length < CONSISTENT_SESSIONS || !hasCatalogDifficulty(id)) continue;
    if (DIFFICULTY_RANK[difficultyFor(id)] >= DIFFICULTY_RANK.advanced) masteredAdvanced++;
  }

  // Training AGE is the gate, with session counts as the consistency check.
  // "Intermediate" means roughly six months of consistent training and
  // "advanced" a year and a half — anyone who squats and deadlifts for ten
  // weeks is not advanced, and a true newcomer is not intermediate in week 4
  // because hip thrusts carry an intermediate tag.
  let level: ExperienceLevel = 'beginner';
  let rationale = 'Still building a base — early days.';

  if (weeks >= INTERMEDIATE_WEEKS && sessions >= INTERMEDIATE_SESSIONS) {
    level = 'intermediate';
    rationale = `You've trained consistently for ${Math.round(weeks / 4.33)} months across ${sessions} sessions — that's intermediate territory.`;
  }

  if (
    (weeks >= ADVANCED_WEEKS && sessions >= ADVANCED_SESSIONS) ||
    (masteredAdvanced >= 3 && weeks >= ADVANCED_MASTERY_WEEKS && sessions >= ADVANCED_MASTERY_SESSIONS)
  ) {
    level = 'advanced';
    rationale = masteredAdvanced >= 3
      ? `You've been consistently handling ${masteredAdvanced} advanced lifts across ${Math.round(weeks / 4.33)} months and ${sessions} sessions — an advanced training history.`
      : `${Math.round(weeks / 52)} year${weeks >= 104 ? 's' : ''} of training and ${sessions} logged sessions — an advanced base.`;
  }

  return { level, sessions, weeks, masteredAdvanced, rationale };
}

// Gates for the inference. Months, not sessions, are what the literature keys
// progression rate to; the session counts stop a sparse year from counting.
export const INTERMEDIATE_WEEKS = 26;
export const INTERMEDIATE_SESSIONS = 40;
export const ADVANCED_WEEKS = 78;
export const ADVANCED_SESSIONS = 120;
const ADVANCED_MASTERY_WEEKS = 52;
const ADVANCED_MASTERY_SESSIONS = 80;

/**
 * The level the engines plan and prescribe with: what the athlete SAID. The
 * inference feeds the Journey's "level up" nudge only — it never changes what
 * the engines use until the user accepts it. Before this it did
 * (max(self-report, inferred)), and a newcomer lost the beginner protections
 * in week four on the strength of a hip-thrust tag. The snapshot parameter is
 * kept so callers don't change; it is unused.
 */
export function effectiveExperience(profile: TrainingProfile, _snapshot: TrainingSnapshot | null): ExperienceLevel {
  void _snapshot;
  return profile.experience;
}

export interface ExperienceSuggestion {
  from: ExperienceLevel;
  to: ExperienceLevel;
  rationale: string;
}

/**
 * A prompt to bump the stored profile up a level, when the data has clearly
 * outgrown the self-report. Null when the profile already matches (or exceeds)
 * what the history shows — the coach never suggests a downgrade.
 */
export function experienceSuggestion(
  profile: TrainingProfile,
  snapshot: TrainingSnapshot | null,
  now = Date.now(),
): ExperienceSuggestion | null {
  if (!snapshot) return null;
  const inference = inferExperience(snapshot, now);
  if (DIFFICULTY_RANK[inference.level] <= DIFFICULTY_RANK[profile.experience]) return null;
  return { from: profile.experience, to: inference.level, rationale: inference.rationale };
}

export function experienceSuggestionText(s: ExperienceSuggestion): string {
  return `${s.rationale} Update your profile from ${experienceLabel(s.from)} to ${experienceLabel(s.to)}?`;
}
