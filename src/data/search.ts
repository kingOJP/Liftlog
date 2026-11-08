// Exercise name search, shared by the Exercises screen and the add-exercise
// picker so both match the same way: case-insensitive, every typed word must
// appear somewhere in the name ("dumbbell inc" finds "Incline Dumbbell Press",
// and "row cable" finds "Seated Cable Row").
//
// Three forgiveness rules, because lifters don't type catalog names:
//   • aliases     — a catalog exercise also matches on every other name it is
//                   known by ("rdl", "ohp", "pec deck"; exercises.ts ALIASES)
//   • spacing     — "pulldown" finds "Lat Pull Down" and "pull-up" finds
//                   "Pull Ups": words are also compared with spaces and
//                   hyphens squeezed out
//   • shorthand   — db / bb / kb / sl stand for dumbbell / barbell /
//                   kettlebell / single leg, and a trailing plural s is
//                   optional ("curls" finds "Barbell Curl")

import { aliasesFor } from './exercises';

const SHORTHAND: Record<string, string> = {
  db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', sl: 'single leg',
};

const squeeze = (s: string) => s.replace(/[\s-]+/g, '');

function wordMatches(word: string, hay: string, squeezed: string): boolean {
  const forms = [word, SHORTHAND[word]].filter((f): f is string => !!f);
  if (word.length > 3 && word.endsWith('s')) forms.push(word.slice(0, -1));
  return forms.some(f => hay.includes(f) || squeezed.includes(squeeze(f)));
}

/** Whether every typed word appears in the name or one of the aliases. */
export function matchesExerciseQuery(name: string, query: string, aliases: readonly string[] = []): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hays = [name, ...aliases].map(h => h.toLowerCase());
  return hays.some(hay => {
    const squeezed = squeeze(hay);
    return words.every(w => wordMatches(w, hay, squeezed));
  });
}

/**
 * Filter a list by a typed query. An item may carry its own `aliases`; one
 * that carries only an `id` gets the catalog's aliases for that id.
 */
export function filterExercises<T extends { name: string; id?: string; aliases?: readonly string[] }>(
  list: T[], query: string,
): T[] {
  if (query.trim() === '') return list;
  return list.filter(e => matchesExerciseQuery(e.name, query, e.aliases ?? (e.id ? aliasesFor(e.id) : [])));
}
