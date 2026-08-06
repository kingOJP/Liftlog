// Test environment setup.
//
// The data layer's only browser dependency is localStorage — a synchronous
// key/value store roughly 20 lines of Map wrapping. Booting jsdom to get it
// cost more than every test in this repo combined (28s of environment setup
// against ~1s of actual assertions), so the suite runs on `node` and gets
// localStorage from here.
//
// The two files that need a real DOM (`share.test.ts` reads window.location)
// opt back in with a `@vitest-environment jsdom` docblock, so jsdom is paid
// for once instead of twenty-five times.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  clear(): void {
    this.map.clear();
  }
}

// Only define it when the environment hasn't already (a jsdom test file has a
// real one, and overwriting that would break window.localStorage identity).
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
