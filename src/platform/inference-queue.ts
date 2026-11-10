type Priority = 'foreground' | 'background';
interface Job {
  work: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  priority: Priority;
  signal?: AbortSignal;
  key?: string;
}

/** One local inference at a time. User requests interrupt and precede speculative preparation. */
export class InferenceQueue {
  private waiting: Job[] = [];
  private current?: { job: Job; controller: AbortController; preempted: boolean };

  run<T>(work: (signal: AbortSignal) => Promise<T>, options: { priority?: Priority; signal?: AbortSignal; key?: string } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) { reject(new Error('Cancelled')); return; }
      this.waiting.push({ work, resolve: (value) => resolve(value as T), reject, priority: options.priority ?? 'foreground', signal: options.signal, key: options.key });
      if (options.priority !== 'background' && this.current?.job.priority === 'background') {
        this.current.preempted = true;
        this.current.controller.abort();
      }
      void this.drain();
    });
  }

  prioritize(key: string): void {
    const job = this.waiting.find((candidate) => candidate.key === key) ??
      (this.current?.job.key === key ? this.current.job : undefined);
    if (!job) return;
    job.priority = 'foreground';
    if (this.current && this.current.job !== job && this.current.job.priority === 'background') {
      this.current.preempted = true;
      this.current.controller.abort();
    }
  }

  private async drain(): Promise<void> {
    if (this.current) return;
    const index = this.waiting.findIndex((job) => job.priority === 'foreground');
    const job = this.waiting.splice(index < 0 ? 0 : index, 1)[0];
    if (!job) return;
    if (job.signal?.aborted) { job.reject(new Error('Cancelled')); void this.drain(); return; }
    const current = { job, controller: new AbortController(), preempted: false };
    this.current = current;
    const abort = () => current.controller.abort();
    job.signal?.addEventListener('abort', abort, { once: true });
    try {
      const value = await job.work(current.controller.signal);
      if (current.controller.signal.aborted) throw new Error('Cancelled');
      job.resolve(value);
    } catch (error) {
      if (current.preempted && !job.signal?.aborted) this.waiting.push(job);
      else job.reject(error);
    } finally {
      job.signal?.removeEventListener('abort', abort);
      this.current = undefined;
      void this.drain();
    }
  }
}
