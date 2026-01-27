import type { KeyState, KeyConfig, StorageAdapter } from './types.js';

/**
 * Quota tracker for managing key usage limits
 * 
 * Tracks usage counts and handles period resets (monthly/yearly).
 * Can sync from API response headers for accuracy.
 */
export class QuotaTracker {
  private storage: StorageAdapter;
  private warningThreshold: number;
  private onWarning: ((key: KeyConfig, usagePercent: number) => void) | undefined;
  private onKeyExhausted: ((key: KeyConfig) => void) | undefined;
  private warnedKeys: Set<string> = new Set();

  constructor(options: {
    storage: StorageAdapter;
    warningThreshold: number;
    onWarning?: ((key: KeyConfig, usagePercent: number) => void) | undefined;
    onKeyExhausted?: ((key: KeyConfig) => void) | undefined;
  }) {
    this.storage = options.storage;
    this.warningThreshold = options.warningThreshold;
    this.onWarning = options.onWarning;
    this.onKeyExhausted = options.onKeyExhausted;
  }

  /**
   * Check if a key has remaining quota
   */
  hasQuota(state: KeyState): boolean {
    this.checkPeriodReset(state);

    if (state.config.quota.type === 'unlimited') {
      return true;
    }

    return state.quotaUsed < state.config.quota.limit;
  }

  /**
   * Get remaining quota for a key
   */
  getRemaining(state: KeyState): number {
    this.checkPeriodReset(state);

    if (state.config.quota.type === 'unlimited') {
      return Infinity;
    }

    return Math.max(0, state.config.quota.limit - state.quotaUsed);
  }

  /**
   * Get usage percentage (0-1)
   */
  getUsagePercent(state: KeyState): number {
    if (state.config.quota.type === 'unlimited') {
      return 0;
    }

    this.checkPeriodReset(state);
    return state.quotaUsed / state.config.quota.limit;
  }

  /**
   * Increment quota usage
   */
  increment(state: KeyState, amount: number = 1): void {
    this.checkPeriodReset(state);

    if (state.config.quota.type === 'unlimited') {
      return;
    }

    state.quotaUsed += amount;

    // Check for warning threshold
    const usagePercent = this.getUsagePercent(state);
    if (usagePercent >= this.warningThreshold && !this.warnedKeys.has(state.config.id)) {
      this.warnedKeys.add(state.config.id);
      this.onWarning?.(state.config, usagePercent);
    }

    // Check for exhaustion
    if (state.quotaUsed >= state.config.quota.limit) {
      this.onKeyExhausted?.(state.config);
    }

    // Persist state
    void this.persistState(state);
  }

  /**
   * Sync quota from API response (e.g., x-ratelimit-remaining header)
   * This allows correcting drift between local tracking and actual API usage
   */
  syncFromResponse(state: KeyState, remaining: number): void {
    if (state.config.quota.type === 'unlimited') {
      return;
    }

    const newUsed = state.config.quota.limit - remaining;
    
    // Only update if the API reports more usage than we tracked
    // (API is source of truth, but we don't want to go backwards)
    if (newUsed > state.quotaUsed) {
      state.quotaUsed = newUsed;
      void this.persistState(state);
    }
  }

  /**
   * Check if period needs to be reset (monthly/yearly)
   */
  private checkPeriodReset(state: KeyState): void {
    const now = new Date();
    const periodStart = state.periodStart;

    let shouldReset = false;

    switch (state.config.quota.type) {
      case 'monthly': {
        // Reset if we're in a new month
        shouldReset =
          now.getUTCFullYear() > periodStart.getUTCFullYear() ||
          (now.getUTCFullYear() === periodStart.getUTCFullYear() &&
            now.getUTCMonth() > periodStart.getUTCMonth());
        break;
      }
      case 'yearly': {
        // Reset if we're in a new year
        shouldReset = now.getUTCFullYear() > periodStart.getUTCFullYear();
        break;
      }
      case 'total':
      case 'unlimited': {
        // Never reset
        shouldReset = false;
        break;
      }
    }

    if (shouldReset) {
      this.reset(state);
    }
  }

  /**
   * Reset quota for a key
   */
  reset(state: KeyState): void {
    state.quotaUsed = 0;
    state.periodStart = new Date();
    this.warnedKeys.delete(state.config.id);
    void this.persistState(state);
  }

  /**
   * Persist quota state to storage
   */
  private async persistState(state: KeyState): Promise<void> {
    const key = `quota:${state.config.id}`;
    const data = JSON.stringify({
      quotaUsed: state.quotaUsed,
      periodStart: state.periodStart.toISOString(),
    });

    // Calculate TTL based on quota type
    let ttl: number | undefined;
    switch (state.config.quota.type) {
      case 'monthly':
        ttl = 35 * 24 * 60 * 60; // 35 days
        break;
      case 'yearly':
        ttl = 370 * 24 * 60 * 60; // ~1 year
        break;
      default:
        ttl = undefined; // No expiry
    }

    await this.storage.set(key, data, ttl);
  }

  /**
   * Load quota state from storage
   */
  async loadState(state: KeyState): Promise<void> {
    const key = `quota:${state.config.id}`;
    const data = await this.storage.get(key);

    if (data) {
      try {
        const parsed = JSON.parse(data) as {
          quotaUsed: number;
          periodStart: string;
        };
        state.quotaUsed = parsed.quotaUsed;
        state.periodStart = new Date(parsed.periodStart);
      } catch {
        // Invalid data, reset to defaults
        this.reset(state);
      }
    }

    // Check for period reset after loading
    this.checkPeriodReset(state);
  }

  /**
   * Get the total quota limit for a key
   */
  getLimit(state: KeyState): number {
    if (state.config.quota.type === 'unlimited') {
      return Infinity;
    }
    return state.config.quota.limit;
  }
}
