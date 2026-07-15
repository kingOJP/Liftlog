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
import { difficultyFor } from './exercises';
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

  // Per-exercise session counts → consistency by difficulty tier.
  let masteredAdvanced = 0;
  let masteredIntermediatePlus = 0;
  for (const [id, points] of exercisePointSeries(snapshot)) {
    if (points.length < CONSISTENT_SESSIONS) continue;
    const rank = DIFFICULTY_RANK[difficultyFor(id)];
    if (rank >= DIFFICULTY_RANK.advanced) masteredAdvanced++;
    if (rank >= DIFFICULTY_RANK.intermediate) masteredIntermediatePlus++;
  }

  // Ratchet up through the tiers. Advanced needs real training age AND either a
  // long history or demonstrated mastery of multiple advanced lifts.
  let level: ExperienceLevel = 'beginner';
  let rationale = 'Still building a base — early days.';

  if ((sessions >= 12 && weeks >= 8) || (masteredIntermediatePlus > 0 && sessions >= 8)) {
    level = 'intermediate';
    rationale = masteredIntermediatePlus > 0
      ? `You've logged ${sessions} sessions and are consistently training compound lifts — that's intermediate territory.`
      : `You've trained consistently for ${weeks} weeks across ${sessions} sessions.`;
  }

  if ((weeks >= 52 && sessions >= 50) || (masteredAdvanced >= 2 && sessions >= 30)) {
    level = 'advanced';
    rationale = masteredAdvanced >= 2
      ? `You're consistently handling ${masteredAdvanced} advanced lifts over ${sessions} sessions — that's an advanced training history.`
      : `Over a year of training and ${sessions} logged sessions — an advanced base.`;
  }

  return { level, sessions, weeks, masteredAdvanced, rationale };
}

/** The level to plan with: never below what the athlete told us about themselves. */
export function effectiveExperience(profile: TrainingProfile, snapshot: TrainingSnapshot | null): ExperienceLevel {
  const self = profile.experience;
  if (!snapshot) return self;
  const inferred = inferExperience(snapshot).level;
  return DIFFICULTY_RANK[inferred] > DIFFICULTY_RANK[self] ? inferred : self;
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
