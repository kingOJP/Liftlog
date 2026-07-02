// Device-local app settings (not synced), stored in localStorage.
// Owns the training-block start date (drives week numbering) and the
// default rest-timer duration.

const SETTINGS_KEY = 'liftlog_settings';
// Pre-Rev-2 builds stored the rest duration under its own key; keep it so
// existing devices don't lose their preference.
const REST_KEY = 'liftlog_rest_seconds';

// First Monday of the original training block — used until the user picks
// their own start date in Settings.
export const DEFAULT_PROGRAM_START = '2026-06-09';

export const REST_PRESETS = [60, 90, 120, 180];
export const DEFAULT_REST_SECONDS = 120;

interface Settings {
  programStart?: string; // yyyy-mm-dd
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) as Settings : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Parse yyyy-mm-dd as a local-time date (new Date('yyyy-mm-dd') would be UTC
// midnight, which shifts the week boundary for anyone west of Greenwich).
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  // new Date() rolls out-of-range parts over (month 13 → January) — reject those
  const valid = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  return valid ? d : null;
}

export function getProgramStartValue(): string {
  const stored = loadSettings().programStart;
  return stored && parseLocalDate(stored) ? stored : DEFAULT_PROGRAM_START;
}

export function getProgramStart(): Date {
  return parseLocalDate(getProgramStartValue())!;
}

export function saveProgramStart(value: string): boolean {
  if (!parseLocalDate(value)) return false;
  saveSettings({ ...loadSettings(), programStart: value });
  return true;
}

export function getRestDuration(): number {
  const raw = Number(localStorage.getItem(REST_KEY));
  return REST_PRESETS.includes(raw) ? raw : DEFAULT_REST_SECONDS;
}

export function saveRestDuration(seconds: number): void {
  localStorage.setItem(REST_KEY, String(seconds));
}
