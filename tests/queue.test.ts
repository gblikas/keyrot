import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestQueue } from '../app/queue.js';
import { QueueTimeoutError, QueueFullError } from '../app/errors.js';

// Helper to silence unhandled promise rejections in tests
function silenceRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

describe('RequestQueue', () => {
  let queue: RequestQueue<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new RequestQueue({
      maxSize: 10,
      defaultMaxWaitMs: 5000,
    });
  });

  afterEach(async () => {
    queue.clear();
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('should add request to queue', async () => {
      let resolveProcess: (() => void) | null = null;
      const processPromise = new Promise<void>(r => { resolveProcess = r; });

      queue.setProcessCallback(async (request) => {
        await processPromise;
        request.resolve('result');
      });

      const promise = queue.enqueue(async () => 'test');
      expect(queue.size).toBe(1);

      resolveProcess!();
      await vi.runAllTimersAsync();
      
      await expect(promise).resolves.toBe('result');
    });

    it('should throw QueueFullError when queue is full', async () => {
      const fullQueue = new RequestQueue<string>({
        maxSize: 2,
        defaultMaxWaitMs: 5000,
      });

      // Don't process - let queue fill up
      fullQueue.setProcessCallback(async () => {
        await new Promise(() => {}); // Never resolves
      });

      // Fill the queue (silence these since they won't resolve)
      const p1 = fullQueue.enqueue(async () => 'test1');
      const p2 = fullQueue.enqueue(async () => 'test2');
      silenceRejection(p1);
      silenceRejection(p2);

      // Third should throw
      await expect(fullQueue.enqueue(async () => 'test3'))
        .rejects.toThrow(QueueFullError);
      
      fullQueue.clear();
    });

    it('should use custom maxWaitMs', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const promise = queue.enqueue(async () => 'test', 1000);
      silenceRejection(promise);
      
      vi.advanceTimersByTime(1001);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(QueueTimeoutError);
      blockResolve?.();
    });

    it('should use default maxWaitMs if not specified', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const promise = queue.enqueue(async () => 'test');
      silenceRejection(promise);
      
      // Advance past the default timeout (5000ms)
      vi.advanceTimersByTime(5001);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(QueueTimeoutError);
      blockResolve?.();
    });
  });

  describe('size', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.size).toBe(0);
    });

    it('should return correct count', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const p1 = queue.enqueue(async () => 'test1');
      const p2 = queue.enqueue(async () => 'test2');
      silenceRejection(p1);
      silenceRejection(p2);

      expect(queue.size).toBe(2);
      blockResolve?.();
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty queue', () => {
      expect(queue.isEmpty).toBe(true);
    });

    it('should return false when queue has items', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const p = queue.enqueue(async () => 'test');
      silenceRejection(p);
      expect(queue.isEmpty).toBe(false);
      blockResolve?.();
    });
  });

  describe('timeout handling', () => {
    it('should reject with QueueTimeoutError on timeout', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const promise = queue.enqueue(async () => 'test', 2000);
      silenceRejection(promise);
      
      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(QueueTimeoutError);
      blockResolve?.();
    });

    it('should include retry info in timeout error', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      // Add multiple items
      const p1 = queue.enqueue(async () => 'test1', 10000);
      const promise = queue.enqueue(async () => 'test2', 1000);
      silenceRejection(p1);
      silenceRejection(promise);
      
      vi.advanceTimersByTime(1001);
      await vi.runAllTimersAsync();

      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QueueTimeoutError);
        const timeoutError = error as QueueTimeoutError;
        expect(timeoutError.waitedMs).toBeGreaterThanOrEqual(1000);
        expect(timeoutError.retryAfterMs).toBeGreaterThan(0);
        expect(timeoutError.queueSize).toBeGreaterThanOrEqual(0);
      }
      blockResolve?.();
    });
  });

  describe('clear', () => {
    it('should reject all pending requests', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const promise1 = queue.enqueue(async () => 'test1');
      const promise2 = queue.enqueue(async () => 'test2');

      queue.clear(new Error('Test clear'));

      await expect(promise1).rejects.toThrow('Test clear');
      await expect(promise2).rejects.toThrow('Test clear');
      blockResolve?.();
    });

    it('should use default error message', async () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const promise = queue.enqueue(async () => 'test');
      
      queue.clear();

      await expect(promise).rejects.toThrow('Queue cleared');
      blockResolve?.();
    });

    it('should reset queue size', () => {
      let blockResolve: (() => void) | null = null;
      queue.setProcessCallback(async () => {
        await new Promise<void>(r => { blockResolve = r; });
      });

      const p1 = queue.enqueue(async () => 'test1');
      const p2 = queue.enqueue(async () => 'test2');
      silenceRejection(p1);
      silenceRejection(p2);

      queue.clear();

      expect(queue.size).toBe(0);
      blockResolve?.();
    });
  });

  describe('processing', () => {
    it('should process requests in FIFO order', async () => {
      const order: string[] = [];

      queue.setProcessCallback(async (request) => {
        const result = await request.execute('key');
        order.push(result);
        request.resolve(result);
      });

      const p1 = queue.enqueue(async () => 'first');
      const p2 = queue.enqueue(async () => 'second');
      const p3 = queue.enqueue(async () => 'third');

      await vi.runAllTimersAsync();
      await Promise.all([p1, p2, p3]);

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('should continue processing after request completes', async () => {
      const processed: string[] = [];

      queue.setProcessCallback(async (request) => {
        const result = await request.execute('key');
        processed.push(result);
        request.resolve(result);
      });

      const p1 = queue.enqueue(async () => 'first');
      await vi.runAllTimersAsync();
      await p1;

      const p2 = queue.enqueue(async () => 'second');
      await vi.runAllTimersAsync();
      await p2;

      expect(processed).toEqual(['first', 'second']);
    });
  });
});
