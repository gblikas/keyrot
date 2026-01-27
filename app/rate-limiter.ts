import type { KeyState } from './types.js';

/**
 * Token bucket rate limiter for RPS control
 * 
 * Uses the token bucket algorithm:
 * - Each key has a bucket that holds up to `rps` tokens
 * - Tokens are consumed when requests are made
 * - Tokens refill at a rate of `rps` per second
 */
export class RateLimiter {
  /**
   * Check if a key has available capacity (without consuming)
   */
  hasCapacity(state: KeyState): boolean {
    if (!state.config.rps) {
      return true; // No RPS limit configured
    }

    const availableTokens = this.getAvailableTokens(state);
    return availableTokens >= 1;
  }

  /**
   * Try to consume a token from the bucket
   * Returns true if successful, false if no tokens available
   */
  tryConsume(state: KeyState): boolean {
    if (!state.config.rps) {
      return true; // No RPS limit configured
    }

    // Refill tokens first
    this.refillTokens(state);

    if (state.tokens >= 1) {
      state.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get the number of available tokens (after refill)
   */
  getAvailableTokens(state: KeyState): number {
    if (!state.config.rps) {
      return Infinity;
    }

    // Calculate tokens without mutating state
    const now = Date.now();
    const elapsed = (now - state.lastTokenRefill.getTime()) / 1000;
    const tokensToAdd = elapsed * state.config.rps;
    const newTokens = Math.min(state.config.rps, state.tokens + tokensToAdd);

    return newTokens;
  }

  /**
   * Get current RPS usage (tokens consumed in last second)
   */
  getCurrentRps(state: KeyState): number {
    if (!state.config.rps) {
      return 0;
    }

    const availableTokens = this.getAvailableTokens(state);
    const consumed = state.config.rps - availableTokens;
    return Math.max(0, consumed);
  }

  /**
   * Get time until next token is available (in ms)
   */
  getTimeUntilAvailable(state: KeyState): number {
    if (!state.config.rps) {
      return 0;
    }

    const availableTokens = this.getAvailableTokens(state);
    if (availableTokens >= 1) {
      return 0;
    }

    // Calculate time needed to refill 1 token
    const tokensNeeded = 1 - availableTokens;
    const secondsNeeded = tokensNeeded / state.config.rps;
    return Math.ceil(secondsNeeded * 1000);
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(state: KeyState): void {
    if (!state.config.rps) {
      return;
    }

    const now = new Date();
    const elapsed = (now.getTime() - state.lastTokenRefill.getTime()) / 1000;
    const tokensToAdd = elapsed * state.config.rps;

    state.tokens = Math.min(state.config.rps, state.tokens + tokensToAdd);
    state.lastTokenRefill = now;
  }

  /**
   * Reset the rate limiter state for a key
   */
  reset(state: KeyState): void {
    if (state.config.rps) {
      state.tokens = state.config.rps;
      state.lastTokenRefill = new Date();
    }
  }
}
