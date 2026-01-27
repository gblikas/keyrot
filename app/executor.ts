import type { KeyState, PoolConfig, QueuedRequest } from './types.js';
import { AllKeysExhaustedError } from './errors.js';
import { RateLimiter } from './rate-limiter.js';
import { QuotaTracker } from './quota-tracker.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { KeySelector } from './selector.js';

/**
 * Request executor with automatic key rotation and retry
 * 
 * Handles:
 * - Key selection and token consumption
 * - 429 detection and retry with different key
 * - Error detection and circuit breaker updates
 * - Quota sync from response headers
 */
export class Executor<TResponse> {
  private config: PoolConfig<TResponse>;
  private states: KeyState[];
  private rateLimiter: RateLimiter;
  private quotaTracker: QuotaTracker;
  private circuitBreaker: CircuitBreaker;
  private selector: KeySelector;
  private maxRetries: number;

  constructor(options: {
    config: PoolConfig<TResponse>;
    states: KeyState[];
    rateLimiter: RateLimiter;
    quotaTracker: QuotaTracker;
    circuitBreaker: CircuitBreaker;
    selector: KeySelector;
  }) {
    this.config = options.config;
    this.states = options.states;
    this.rateLimiter = options.rateLimiter;
    this.quotaTracker = options.quotaTracker;
    this.circuitBreaker = options.circuitBreaker;
    this.selector = options.selector;
    this.maxRetries = options.config.maxRetries ?? options.states.length;
  }

  /**
   * Execute a queued request
   */
  async executeRequest(request: QueuedRequest<TResponse>): Promise<void> {
    const triedKeys = new Set<string>();
    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount < this.maxRetries) {
      // Select next available key
      const state = this.selector.selectKey(this.states, triedKeys);

      if (!state) {
        // No keys available
        const breakdown = this.selector.getAvailabilityBreakdown(this.states);
        const retryAfterMs = this.selector.getNextAvailableTime(this.states);

        lastError = new AllKeysExhaustedError({
          retryAfterMs,
          exhaustedKeys: breakdown.quotaExhausted,
          circuitOpenKeys: breakdown.circuitOpen,
          rateLimitedKeys: breakdown.rateLimited,
          totalKeys: this.states.length,
        });

        // Call callback if configured
        this.config.onAllKeysExhausted?.();
        break;
      }

      triedKeys.add(state.config.id);

      try {
        // Consume rate limit token
        if (!this.rateLimiter.tryConsume(state)) {
          // Key is rate limited, try next
          retryCount++;
          continue;
        }

        // Execute the request
        const response = await request.execute(state.config.value);

        // Check for rate limiting
        if (this.config.isRateLimited?.(response)) {
          this.handleRateLimited(state, response);
          retryCount++;
          continue;
        }

        // Check for errors that should trigger rotation
        if (this.config.isError?.(response)) {
          this.circuitBreaker.recordFailure(state);
          retryCount++;
          continue;
        }

        // Success!
        this.handleSuccess(state, response);
        request.resolve(response);
        return;

      } catch (error) {
        // Request threw an error (network error, timeout, etc.)
        this.circuitBreaker.recordFailure(state);
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;
      }
    }

    // All retries exhausted
    if (lastError) {
      request.reject(lastError);
    } else {
      const breakdown = this.selector.getAvailabilityBreakdown(this.states);
      request.reject(new AllKeysExhaustedError({
        retryAfterMs: this.selector.getNextAvailableTime(this.states),
        exhaustedKeys: breakdown.quotaExhausted,
        circuitOpenKeys: breakdown.circuitOpen,
        rateLimitedKeys: breakdown.rateLimited,
        totalKeys: this.states.length,
      }));
    }
  }

  /**
   * Handle a rate-limited response
   */
  private handleRateLimited(state: KeyState, response: TResponse): void {
    // Get retry-after from response
    const retryAfter = this.config.getRetryAfter?.(response);
    
    if (retryAfter !== null && retryAfter !== undefined) {
      // Set temporary rate limit
      state.rateLimitedUntil = new Date(Date.now() + retryAfter * 1000);
    } else {
      // Default to 60 seconds
      state.rateLimitedUntil = new Date(Date.now() + 60000);
    }
  }

  /**
   * Handle a successful response
   */
  private handleSuccess(state: KeyState, response: TResponse): void {
    // Record success for circuit breaker
    this.circuitBreaker.recordSuccess(state);

    // Update last used
    state.lastUsed = new Date();

    // Increment quota
    this.quotaTracker.increment(state);

    // Sync quota from response headers if available
    const remaining = this.config.getQuotaRemaining?.(response);
    if (remaining !== null && remaining !== undefined) {
      this.quotaTracker.syncFromResponse(state, remaining);
    }

    // Clear any temporary rate limit
    state.rateLimitedUntil = null;
  }

  /**
   * Update states reference (for dynamic key updates)
   */
  updateStates(states: KeyState[]): void {
    this.states = states;
    this.maxRetries = this.config.maxRetries ?? states.length;
  }
}
