import type { KeyState, KeyConfig, CircuitBreakerConfig } from './types.js';

/**
 * Circuit breaker for managing failing keys
 * 
 * States:
 * - closed: Key is healthy, requests flow normally
 * - open: Key is failing, requests are blocked
 * - half-open: Testing if key has recovered
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private onKeyCircuitOpen: ((key: KeyConfig) => void) | undefined;

  constructor(options: {
    config: CircuitBreakerConfig;
    onKeyCircuitOpen?: ((key: KeyConfig) => void) | undefined;
  }) {
    this.config = options.config;
    this.onKeyCircuitOpen = options.onKeyCircuitOpen;
  }

  /**
   * Check if the circuit allows requests
   */
  isAvailable(state: KeyState): boolean {
    this.checkTransition(state);
    return state.circuitState !== 'open';
  }

  /**
   * Record a successful request
   */
  recordSuccess(state: KeyState): void {
    state.consecutiveFailures = 0;

    // If half-open, transition to closed
    if (state.circuitState === 'half-open') {
      state.circuitState = 'closed';
      state.circuitOpenUntil = null;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(state: KeyState): void {
    state.consecutiveFailures += 1;

    // Check if we should open the circuit
    if (state.consecutiveFailures >= this.config.failureThreshold) {
      this.openCircuit(state);
    }
  }

  /**
   * Get the time until the circuit might close (in ms)
   */
  getTimeUntilReset(state: KeyState): number {
    if (state.circuitState !== 'open' || !state.circuitOpenUntil) {
      return 0;
    }

    const now = Date.now();
    const remaining = state.circuitOpenUntil.getTime() - now;
    return Math.max(0, remaining);
  }

  /**
   * Get the circuit state
   */
  getState(state: KeyState): 'closed' | 'open' | 'half-open' {
    this.checkTransition(state);
    return state.circuitState;
  }

  /**
   * Force the circuit to close (for manual recovery)
   */
  forceClose(state: KeyState): void {
    state.circuitState = 'closed';
    state.circuitOpenUntil = null;
    state.consecutiveFailures = 0;
  }

  /**
   * Force the circuit to open (for manual intervention)
   */
  forceOpen(state: KeyState): void {
    this.openCircuit(state);
  }

  /**
   * Open the circuit
   */
  private openCircuit(state: KeyState): void {
    const wasOpen = state.circuitState === 'open';
    
    state.circuitState = 'open';
    state.circuitOpenUntil = new Date(Date.now() + this.config.resetTimeoutMs);

    // Only notify on initial open
    if (!wasOpen) {
      this.onKeyCircuitOpen?.(state.config);
    }
  }

  /**
   * Check if circuit should transition states
   */
  private checkTransition(state: KeyState): void {
    if (state.circuitState !== 'open' || !state.circuitOpenUntil) {
      return;
    }

    const now = Date.now();
    if (now >= state.circuitOpenUntil.getTime()) {
      // Transition to half-open to test the key
      state.circuitState = 'half-open';
      state.circuitOpenUntil = null;
    }
  }

  /**
   * Reset the circuit breaker state
   */
  reset(state: KeyState): void {
    state.circuitState = 'closed';
    state.circuitOpenUntil = null;
    state.consecutiveFailures = 0;
  }
}
