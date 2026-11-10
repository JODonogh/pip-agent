import { describe, expect, it } from 'vitest';
import { InferenceQueue } from './inference-queue';

describe('local inference scheduling', () => {
  it('interrupts background work for an interactive request and retries it afterwards', async () => {
    const queue = new InferenceQueue();
    const order: string[] = [];
    let attempts = 0;
    const background = queue.run(async (signal) => {
      order.push(`background-${++attempts}`);
      if (attempts === 1) await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
      return 'prepared';
    }, { priority: 'background' });
    const foreground = queue.run(async () => { order.push('question'); return 'answer'; });
    expect(await foreground).toBe('answer');
    expect(await background).toBe('prepared');
    expect(order).toEqual(['background-1', 'question', 'background-2']);
  });

  it('promotes the section opened by the engineer without duplicating its job', async () => {
    const queue = new InferenceQueue();
    const order: string[] = [];
    let release!: () => void;
    const overview = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = queue.run(async () => { order.push('analogy'); }, { priority: 'background', key: 'analogy' });
    const selected = queue.run(async () => { order.push('foundations'); }, { priority: 'background', key: 'foundations' });
    queue.prioritize('foundations');
    release();
    await Promise.all([overview, first, selected]);
    expect(order).toEqual(['foundations', 'analogy']);
  });

  it('cancels an obsolete selection and continues with the next request', async () => {
    const queue = new InferenceQueue();
    const controller = new AbortController();
    const obsolete = queue.run((signal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('obsolete')), { once: true })), { signal: controller.signal });
    controller.abort();
    await expect(obsolete).rejects.toThrow('obsolete');
    expect(await queue.run(async () => 'new selection')).toBe('new selection');
  });
});
