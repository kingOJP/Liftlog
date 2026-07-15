// Device-local app settings (not synced), stored in localStorage.
// Owns the week-numbering anchor (managed automatically by the training
// journey — no user-facing setting) and the default rest-timer duration.

const SETTINGS_KEY = 'liftlog_settings';
// Pre-Rev-2 builds stored the rest duration under its own key; keep it so
// existing devices don't lose their preference.
const REST_KEY = 'liftlog_rest_seconds';

export const REST_PRESETS = [60, 120, 180, 300];
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

function toDateValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The week-numbering anchor. Nobody sets this by hand anymore: block
// activation anchors it to the block's start, wrapping a block re-anchors it
// to the block's end (planStore.ensureWeekAnchor keeps devices consistent),
// and before any journey exists it defaults to first use of the app on this
// device — stamped on first read so week numbers stay stable afterwards.
export function getProgramStartValue(): string {
  const settings = loadSettings();
  if (settings.programStart && parseLocalDate(settings.programStart)) {
    return settings.programStart;
  }
  const today = toDateValue(new Date());
  saveSettings({ ...settings, programStart: today });
  return today;
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
