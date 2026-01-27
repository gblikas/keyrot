import type { QueuedRequest } from './types.js';
import { QueueTimeoutError, QueueFullError } from './errors.js';

/**
 * Request queue with timeout support
 * 
 * Manages pending requests in FIFO order with configurable timeouts.
 * When the queue is full or timeout is exceeded, appropriate errors are thrown.
 */
export class RequestQueue<TResponse> {
  private queue: QueuedRequest<TResponse>[] = [];
  private maxSize: number;
  private defaultMaxWaitMs: number;
  private processing: boolean = false;
  private processCallback: ((request: QueuedRequest<TResponse>) => Promise<void>) | null = null;
  private timeoutCheckerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    maxSize: number;
    defaultMaxWaitMs: number;
  }) {
    this.maxSize = options.maxSize;
    this.defaultMaxWaitMs = options.defaultMaxWaitMs;
  }

  /**
   * Set the callback for processing requests
   */
  setProcessCallback(callback: (request: QueuedRequest<TResponse>) => Promise<void>): void {
    this.processCallback = callback;
  }

  /**
   * Add a request to the queue
   */
  async enqueue(
    execute: (keyValue: string) => Promise<TResponse>,
    maxWaitMs?: number
  ): Promise<TResponse> {
    // Check if queue is full
    if (this.queue.length >= this.maxSize) {
      throw new QueueFullError({
        queueSize: this.queue.length,
        maxQueueSize: this.maxSize,
        retryAfterMs: this.estimateRetryAfter(),
      });
    }

    const effectiveMaxWait = maxWaitMs ?? this.defaultMaxWaitMs;

    return new Promise<TResponse>((resolve, reject) => {
      const request: QueuedRequest<TResponse> = {
        id: this.generateId(),
        execute,
        resolve,
        reject,
        queuedAt: new Date(),
        maxWaitMs: effectiveMaxWait,
        retryCount: 0,
      };

      this.queue.push(request);
      this.startTimeoutChecker();
      this.processNext();
    });
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Start processing the queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0 || !this.processCallback) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const request = this.queue[0];
        
        // Check if request has timed out
        if (this.isTimedOut(request)) {
          this.queue.shift();
          request.reject(new QueueTimeoutError({
            waitedMs: Date.now() - request.queuedAt.getTime(),
            retryAfterMs: this.estimateRetryAfter(),
            queueSize: this.queue.length,
          }));
          continue;
        }

        try {
          await this.processCallback(request);
          this.queue.shift();
        } catch (_error) {
          // Request failed, it's been handled by the callback
          this.queue.shift();
        }
      }
    } finally {
      this.processing = false;
      this.stopTimeoutChecker();
    }
  }

  /**
   * Check if a request has timed out
   */
  private isTimedOut(request: QueuedRequest<TResponse>): boolean {
    const elapsed = Date.now() - request.queuedAt.getTime();
    return elapsed >= request.maxWaitMs;
  }

  /**
   * Start the timeout checker interval
   */
  private startTimeoutChecker(): void {
    if (this.timeoutCheckerInterval) {
      return;
    }

    // Check for timeouts every 100ms
    this.timeoutCheckerInterval = setInterval(() => {
      this.checkTimeouts();
    }, 100);
  }

  /**
   * Stop the timeout checker interval
   */
  private stopTimeoutChecker(): void {
    if (this.timeoutCheckerInterval) {
      clearInterval(this.timeoutCheckerInterval);
      this.timeoutCheckerInterval = null;
    }
  }

  /**
   * Check all queued requests for timeouts
   */
  private checkTimeouts(): void {
    const now = Date.now();
    
    // Check requests from the end to avoid index shifting issues
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const request = this.queue[i];
      const elapsed = now - request.queuedAt.getTime();
      
      if (elapsed >= request.maxWaitMs) {
        this.queue.splice(i, 1);
        request.reject(new QueueTimeoutError({
          waitedMs: elapsed,
          retryAfterMs: this.estimateRetryAfter(),
          queueSize: this.queue.length,
        }));
      }
    }

    // Stop checker if queue is empty
    if (this.queue.length === 0) {
      this.stopTimeoutChecker();
    }
  }

  /**
   * Estimate retry-after time based on queue state
   */
  private estimateRetryAfter(): number {
    // Base estimate: 1 second per queued request, minimum 1 second
    return Math.max(1000, this.queue.length * 1000);
  }

  /**
   * Generate a unique request ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Clear all pending requests with an error
   */
  clear(error?: Error): void {
    const err = error ?? new Error('Queue cleared');
    
    for (const request of this.queue) {
      request.reject(err);
    }
    
    this.queue = [];
    this.stopTimeoutChecker();
  }

  /**
   * Trigger processing (called when keys become available)
   */
  triggerProcess(): void {
    this.processNext();
  }
}
