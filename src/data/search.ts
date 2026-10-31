// Exercise name search, shared by the Exercises screen and the add-exercise
// picker so both match the same way: case-insensitive, every typed word must
// appear somewhere in the name ("db inc" finds "Incline Dumbbell Press" if
// you type "dumbbell inc", and "row cable" finds "Seated Cable Row").

export function matchesExerciseQuery(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = name.toLowerCase();
  return words.every(w => hay.includes(w));
}

export function filterExercises<T extends { name: string }>(list: T[], query: string): T[] {
  return list.filter(e => matchesExerciseQuery(e.name, query));
}
