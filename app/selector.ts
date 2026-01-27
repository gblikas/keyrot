import type { KeyState } from './types.js';
import { RateLimiter } from './rate-limiter.js';
import { QuotaTracker } from './quota-tracker.js';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * Key selector for choosing the next available key
 * 
 * Uses weighted round-robin with fallback strategies:
 * 1. Try keys in round-robin order (respecting weights)
 * 2. Skip keys that are rate-limited, exhausted, or circuit-open
 * 3. Return null if no keys are available
 */
export class KeySelector {
  private rateLimiter: RateLimiter;
  private quotaTracker: QuotaTracker;
  private circuitBreaker: CircuitBreaker;
  private currentIndex: number = 0;

  constructor(options: {
    rateLimiter: RateLimiter;
    quotaTracker: QuotaTracker;
    circuitBreaker: CircuitBreaker;
  }) {
    this.rateLimiter = options.rateLimiter;
    this.quotaTracker = options.quotaTracker;
    this.circuitBreaker = options.circuitBreaker;
  }

  /**
   * Select the next available key
   * Returns null if no keys are available
   */
  selectKey(states: KeyState[], excludeIds?: Set<string>): KeyState | null {
    if (states.length === 0) {
      return null;
    }

    // Build weighted list (each key appears weight times)
    const weightedStates = this.buildWeightedList(states);
    if (weightedStates.length === 0) {
      return null;
    }

    // Try each key in round-robin order
    const startIndex = this.currentIndex % weightedStates.length;
    
    for (let i = 0; i < weightedStates.length; i++) {
      const index = (startIndex + i) % weightedStates.length;
      const state = weightedStates[index];

      // Skip excluded keys (already tried in this request)
      if (excludeIds?.has(state.config.id)) {
        continue;
      }

      // Check if key is available
      if (this.isKeyAvailable(state)) {
        this.currentIndex = index + 1;
        return state;
      }
    }

    return null;
  }

  /**
   * Check if a key is available for use
   */
  isKeyAvailable(state: KeyState): boolean {
    // Check circuit breaker
    if (!this.circuitBreaker.isAvailable(state)) {
      return false;
    }

    // Check quota
    if (!this.quotaTracker.hasQuota(state)) {
      return false;
    }

    // Check rate limit
    if (!this.rateLimiter.hasCapacity(state)) {
      return false;
    }

    // Check temporary rate limit from API response
    if (state.rateLimitedUntil && state.rateLimitedUntil.getTime() > Date.now()) {
      return false;
    }

    return true;
  }

  /**
   * Get the count of available keys
   */
  getAvailableCount(states: KeyState[]): number {
    return states.filter(state => this.isKeyAvailable(state)).length;
  }

  /**
   * Get key availability breakdown
   */
  getAvailabilityBreakdown(states: KeyState[]): {
    available: number;
    rateLimited: number;
    quotaExhausted: number;
    circuitOpen: number;
  } {
    let available = 0;
    let rateLimited = 0;
    let quotaExhausted = 0;
    let circuitOpen = 0;

    for (const state of states) {
      if (!this.circuitBreaker.isAvailable(state)) {
        circuitOpen++;
      } else if (!this.quotaTracker.hasQuota(state)) {
        quotaExhausted++;
      } else if (!this.rateLimiter.hasCapacity(state) || 
                 (state.rateLimitedUntil && state.rateLimitedUntil.getTime() > Date.now())) {
        rateLimited++;
      } else {
        available++;
      }
    }

    return { available, rateLimited, quotaExhausted, circuitOpen };
  }

  /**
   * Get the shortest wait time until any key becomes available
   */
  getNextAvailableTime(states: KeyState[]): number {
    let minWait = Infinity;

    for (const state of states) {
      // Check circuit breaker reset time
      const circuitWait = this.circuitBreaker.getTimeUntilReset(state);
      if (circuitWait > 0 && circuitWait < minWait) {
        minWait = circuitWait;
      }

      // Check rate limit reset time
      const rpsWait = this.rateLimiter.getTimeUntilAvailable(state);
      if (rpsWait > 0 && rpsWait < minWait) {
        minWait = rpsWait;
      }

      // Check temporary rate limit
      if (state.rateLimitedUntil) {
        const tempWait = state.rateLimitedUntil.getTime() - Date.now();
        if (tempWait > 0 && tempWait < minWait) {
          minWait = tempWait;
        }
      }
    }

    return minWait === Infinity ? 60000 : minWait; // Default to 60s if no info
  }

  /**
   * Build a weighted list of keys
   * Each key appears (weight) times in the list
   */
  private buildWeightedList(states: KeyState[]): KeyState[] {
    const weighted: KeyState[] = [];

    for (const state of states) {
      const weight = state.config.weight ?? 1;
      for (let i = 0; i < weight; i++) {
        weighted.push(state);
      }
    }

    return weighted;
  }

  /**
   * Reset the selector state
   */
  reset(): void {
    this.currentIndex = 0;
  }
}
