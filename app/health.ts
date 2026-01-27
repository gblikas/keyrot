import type { KeyState, HealthStatus, HealthWarning } from './types.js';
import { QuotaTracker } from './quota-tracker.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { KeySelector } from './selector.js';

/**
 * Health monitor for the key pool
 * 
 * Computes overall health status based on key availability,
 * quota usage, and circuit breaker states.
 */
export class HealthMonitor {
  private quotaTracker: QuotaTracker;
  private circuitBreaker: CircuitBreaker;
  private selector: KeySelector;
  private warningThreshold: number;

  constructor(options: {
    quotaTracker: QuotaTracker;
    circuitBreaker: CircuitBreaker;
    selector: KeySelector;
    warningThreshold: number;
  }) {
    this.quotaTracker = options.quotaTracker;
    this.circuitBreaker = options.circuitBreaker;
    this.selector = options.selector;
    this.warningThreshold = options.warningThreshold;
  }

  /**
   * Get the current health status of the pool
   */
  getHealth(states: KeyState[]): HealthStatus {
    const breakdown = this.selector.getAvailabilityBreakdown(states);
    const totalKeys = states.length;
    const availableKeys = breakdown.available;

    // Calculate effective capacity
    let effectiveRps = 0;
    let effectiveQuotaRemaining = 0;
    let effectiveQuotaTotal = 0;

    for (const state of states) {
      // Add to totals
      const quotaLimit = this.quotaTracker.getLimit(state);
      if (quotaLimit !== Infinity) {
        effectiveQuotaTotal += quotaLimit;
      }

      // Only count available keys for effective values
      if (this.selector.isKeyAvailable(state)) {
        if (state.config.rps) {
          effectiveRps += state.config.rps;
        }
        
        const remaining = this.quotaTracker.getRemaining(state);
        if (remaining !== Infinity) {
          effectiveQuotaRemaining += remaining;
        }
      }
    }

    // Determine status
    const status = this.calculateStatus(availableKeys, totalKeys);

    // Collect warnings
    const warnings = this.collectWarnings(states);

    return {
      status,
      availableKeys,
      totalKeys,
      effectiveRps,
      effectiveQuotaRemaining,
      effectiveQuotaTotal,
      warnings,
    };
  }

  /**
   * Calculate the health status based on available capacity
   */
  private calculateStatus(
    availableKeys: number,
    totalKeys: number
  ): HealthStatus['status'] {
    if (totalKeys === 0) {
      return 'exhausted';
    }

    const availablePercent = availableKeys / totalKeys;

    if (availablePercent === 0) {
      return 'exhausted';
    } else if (availablePercent < 0.2) {
      return 'critical';
    } else if (availablePercent < 0.5) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  /**
   * Collect all current warnings
   */
  private collectWarnings(states: KeyState[]): HealthWarning[] {
    const warnings: HealthWarning[] = [];
    const now = new Date();

    for (const state of states) {
      // Check quota warning
      const usagePercent = this.quotaTracker.getUsagePercent(state);
      if (usagePercent >= this.warningThreshold && usagePercent < 1) {
        warnings.push({
          keyId: state.config.id,
          type: 'quota_warning',
          message: `Key "${state.config.id}" is at ${(usagePercent * 100).toFixed(1)}% quota usage`,
          timestamp: now,
        });
      }

      // Check quota exhausted
      if (!this.quotaTracker.hasQuota(state)) {
        warnings.push({
          keyId: state.config.id,
          type: 'quota_exhausted',
          message: `Key "${state.config.id}" has exhausted its quota`,
          timestamp: now,
        });
      }

      // Check rate limited
      if (state.rateLimitedUntil && state.rateLimitedUntil.getTime() > Date.now()) {
        const remaining = Math.ceil((state.rateLimitedUntil.getTime() - Date.now()) / 1000);
        warnings.push({
          keyId: state.config.id,
          type: 'rate_limited',
          message: `Key "${state.config.id}" is rate limited for ${remaining}s`,
          timestamp: now,
        });
      }

      // Check circuit open
      if (this.circuitBreaker.getState(state) === 'open') {
        const remaining = Math.ceil(this.circuitBreaker.getTimeUntilReset(state) / 1000);
        warnings.push({
          keyId: state.config.id,
          type: 'circuit_open',
          message: `Key "${state.config.id}" circuit is open, resets in ${remaining}s`,
          timestamp: now,
        });
      }
    }

    return warnings;
  }
}
