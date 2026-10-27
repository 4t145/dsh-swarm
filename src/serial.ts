/** In-process ordering primitives; rejected operations never poison the queue. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Run after all previously admitted operations, preserving this result/error. */
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Observe already admitted work without admitting another operation. */
  idle(): Promise<void> {
    return this.tail;
  }
}

/** Independent keys execute concurrently; each key has FIFO ordering. */
export class KeyedSerialQueue {
  private readonly queues = new Map<string, SerialQueue>();

  /** Serialize one operation with previous work under the same key. */
  run<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(key, queue);
    }
    return queue.run(operation);
  }

  /** Drain all keys currently in this queue. */
  async idle(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.idle()));
  }
}

/** Shared by control admission and the short result-publication critical section. */
export interface PublicationGate {
  run<T>(runId: string, operation: () => Promise<T>): Promise<T>;
}
