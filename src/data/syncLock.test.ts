import { describe, it, expect } from 'vitest';
import { createSyncLock } from './syncLock';

const tick = () => new Promise(r => setTimeout(r, 1));

describe('syncLock — pull, push and purge never overlap', () => {
  it('runs queued tasks strictly one after another', async () => {
    const lock = createSyncLock();
    const log: string[] = [];
    const a = lock.run(async () => { log.push('a:start'); await tick(); await tick(); log.push('a:end'); return 'a'; });
    const b = lock.run(async () => { log.push('b:start'); await tick(); log.push('b:end'); return 'b'; });
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('a failing task reports to its caller and does not block the next one', async () => {
    const lock = createSyncLock();
    const failed = lock.run(async () => { throw new Error('offline'); });
    const next = lock.run(async () => 'ran');
    await expect(failed).rejects.toThrow('offline');
    expect(await next).toBe('ran');
  });

  it('reports busy only while a task holds it', async () => {
    const lock = createSyncLock();
    expect(lock.busy).toBe(false);
    const p = lock.run(async () => { await tick(); });
    await Promise.resolve();
    expect(lock.busy).toBe(true);
    await p;
    expect(lock.busy).toBe(false);
  });
});
