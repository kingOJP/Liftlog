// Records TypeScript engine outputs as parity fixtures.
//
// A fixture file is { engine, cases: [{ name, fn, args, output, now?, storage? }] }.
// `storage` is the raw localStorage the case runs against (key → stored
// string), `now` the frozen Date.now(). Every case runs in America/Chicago
// (the npm script pins TZ) so DST edges are exercised deterministically.
//
// Output normalization (mirrored by the Swift harness): undefined keys are
// dropped, NaN/±Infinity become null, a Map becomes an array of [key, value]
// pairs in insertion order, a Set becomes an array.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Default frozen clock: Wed 2026-03-18 10:00 America/Chicago. */
export const DEFAULT_NOW = Date.UTC(2026, 2, 18, 15, 0, 0);

export interface CaseOptions {
  storage?: Record<string, unknown>;
  now?: number;
}

interface ParityCase {
  name: string;
  fn: string;
  args: unknown[];
  output: unknown;
  now: number;
  storage?: Record<string, string>;
}

export function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value !== 'object') return value;
  if (value instanceof Map) return [...value.entries()].map(([k, v]) => [normalize(k), normalize(v)]);
  if (value instanceof Set) return [...value].map(normalize);
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : normalize(v)));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || typeof v === 'function') continue;
    out[k] = normalize(v);
  }
  return out;
}

function encodeStorage(storage: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!storage) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(storage)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

export class Fixture {
  private cases: ParityCase[] = [];
  private names = new Set<string>();
  constructor(readonly engine: string) {}

  /**
   * Run `call` under the case's storage + clock and record its output.
   * `args` are the JSON inputs the Swift side receives (the call should use
   * exactly these values).
   */
  record<A extends unknown[]>(name: string, fn: string, args: A, call: (...a: A) => unknown, opts: CaseOptions = {}): unknown {
    if (this.names.has(name)) throw new Error(`duplicate parity case ${this.engine}/${name}`);
    this.names.add(name);
    const storage = encodeStorage(opts.storage);
    const now = opts.now ?? DEFAULT_NOW;
    localStorage.clear();
    for (const [k, v] of Object.entries(storage ?? {})) localStorage.setItem(k, v);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    // Inputs round-trip through JSON so the engine sees exactly what Swift decodes.
    const jsonArgs = JSON.parse(JSON.stringify(args)) as A;
    let output: unknown;
    try {
      output = call(...jsonArgs);
    } finally {
      vi.useRealTimers();
      localStorage.clear();
    }
    this.cases.push({
      name, fn,
      args: normalize(jsonArgs) as unknown[],
      output: normalize(output) ?? null,
      now,
      ...(storage ? { storage } : {}),
    });
    return output;
  }

  write(): void {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const body = JSON.stringify({ engine: this.engine, cases: this.cases }, null, 1);
    writeFileSync(join(FIXTURE_DIR, `${this.engine}.json`), body + '\n');
  }
}
