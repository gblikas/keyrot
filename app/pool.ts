import type {
  PoolConfig,
  KeyConfig,
  KeyState,
  KeyStats,
  HealthStatus,
  ExecuteOptions,
  CircuitBreakerConfig,
} from './types.js';
import { NoKeysConfiguredError, InvalidKeyConfigError } from './errors.js';
import { RateLimiter } from './rate-limiter.js';
import { QuotaTracker } from './quota-tracker.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { KeySelector } from './selector.js';
import { RequestQueue } from './queue.js';
import { Executor } from './executor.js';
import { HealthMonitor } from './health.js';
import { memoryAdapter } from './storage/memory.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
  maxQueueSize: 1000,
  defaultMaxWaitMs: 30000,
  warningThreshold: 0.8,
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 60000,
  } satisfies CircuitBreakerConfig,
};

/**
 * Key pool interface
 */
export interface KeyPool<TResponse> {
  /**
   * Execute a request using the pool
   * Automatically selects a key, handles retries, and manages quotas
   */
  execute(
    fn: (keyValue: string) => Promise<TResponse>,
    options?: ExecuteOptions
  ): Promise<TResponse>;

  /**
   * Get the current health status of the pool
   */
  getHealth(): HealthStatus;

  /**
   * Get statistics for a specific key
   */
  getKeyStats(keyId: string): KeyStats | null;

  /**
   * Get statistics for all keys
   */
  getAllKeyStats(): KeyStats[];

  /**
   * Get the current queue size
   */
  getQueueSize(): number;

  /**
   * Add a key to the pool dynamically
   */
  addKey(key: KeyConfig): void;

  /**
   * Remove a key from the pool
   */
  removeKey(keyId: string): boolean;

  /**
   * Force close a circuit breaker for a key
   */
  closeCircuit(keyId: string): boolean;

  /**
   * Force open a circuit breaker for a key
   */
  openCircuit(keyId: string): boolean;

  /**
   * Reset quota for a key
   */
  resetQuota(keyId: string): boolean;

  /**
   * Shutdown the pool gracefully
   */
  shutdown(): Promise<void>;
}

/**
 * Create a new key pool
 */
export function createKeyPool<TResponse = Response>(
  config: PoolConfig<TResponse>
): KeyPool<TResponse> {
  // Validate configuration
  if (!config.keys || config.keys.length === 0) {
    throw new NoKeysConfiguredError();
  }

  for (const key of config.keys) {
    validateKeyConfig(key);
  }

  // Initialize storage
  const storage = config.storage ?? memoryAdapter();

  // Initialize components
  const rateLimiter = new RateLimiter();

  const quotaTracker = new QuotaTracker({
    storage,
    warningThreshold: config.warningThreshold ?? DEFAULTS.warningThreshold,
    onWarning: config.onWarning,
    onKeyExhausted: config.onKeyExhausted,
  });

  const circuitBreakerConfig = {
    ...DEFAULTS.circuitBreaker,
    ...config.circuitBreaker,
  };

  const circuitBreaker = new CircuitBreaker({
    config: circuitBreakerConfig,
    onKeyCircuitOpen: config.onKeyCircuitOpen,
  });

  // Initialize key states
  const states: KeyState[] = config.keys.map(key => createKeyState(key));

  // Load persisted state - store the promise so execute() can await it
  const initPromise = Promise.all(
    states.map(state => quotaTracker.loadState(state))
  );

  // Initialize selector
  const selector = new KeySelector({
    rateLimiter,
    quotaTracker,
    circuitBreaker,
  });

  // Initialize executor
  const executor = new Executor({
    config,
    states,
    rateLimiter,
    quotaTracker,
    circuitBreaker,
    selector,
  });

  // Initialize queue
  const queue = new RequestQueue<TResponse>({
    maxSize: config.maxQueueSize ?? DEFAULTS.maxQueueSize,
    defaultMaxWaitMs: config.defaultMaxWaitMs ?? DEFAULTS.defaultMaxWaitMs,
  });

  // Set up queue processing
  queue.setProcessCallback(async (request) => {
    await executor.executeRequest(request);
  });

  // Initialize health monitor
  const healthMonitor = new HealthMonitor({
    quotaTracker,
    circuitBreaker,
    selector,
    warningThreshold: config.warningThreshold ?? DEFAULTS.warningThreshold,
  });

  // Return the pool interface
  return {
    async execute(
      fn: (keyValue: string) => Promise<TResponse>,
      options?: ExecuteOptions
    ): Promise<TResponse> {
      // Ensure state is loaded before accepting requests
      // This awaits on first call; subsequent calls return immediately (promise already resolved)
      await initPromise;
      return queue.enqueue(fn, options?.maxWaitMs);
    },

    getHealth(): HealthStatus {
      return healthMonitor.getHealth(states);
    },

    getKeyStats(keyId: string): KeyStats | null {
      const state = states.find(s => s.config.id === keyId);
      if (!state) {
        return null;
      }
      return buildKeyStats(state, rateLimiter, quotaTracker, circuitBreaker);
    },

    getAllKeyStats(): KeyStats[] {
      return states.map(state =>
        buildKeyStats(state, rateLimiter, quotaTracker, circuitBreaker)
      );
    },

    getQueueSize(): number {
      return queue.size;
    },

    addKey(key: KeyConfig): void {
      validateKeyConfig(key);
      
      // Check for duplicate ID
      if (states.some(s => s.config.id === key.id)) {
        throw new InvalidKeyConfigError(key.id, 'Key ID already exists');
      }

      const state = createKeyState(key);
      states.push(state);
      executor.updateStates(states);

      // Load persisted state
      void quotaTracker.loadState(state);
    },

    removeKey(keyId: string): boolean {
      const index = states.findIndex(s => s.config.id === keyId);
      if (index === -1) {
        return false;
      }

      states.splice(index, 1);
      executor.updateStates(states);
      return true;
    },

    closeCircuit(keyId: string): boolean {
      const state = states.find(s => s.config.id === keyId);
      if (!state) {
        return false;
      }

      circuitBreaker.forceClose(state);
      return true;
    },

    openCircuit(keyId: string): boolean {
      const state = states.find(s => s.config.id === keyId);
      if (!state) {
        return false;
      }

      circuitBreaker.forceOpen(state);
      return true;
    },

    resetQuota(keyId: string): boolean {
      const state = states.find(s => s.config.id === keyId);
      if (!state) {
        return false;
      }

      quotaTracker.reset(state);
      return true;
    },

    async shutdown(): Promise<void> {
      queue.clear(new Error('Pool is shutting down'));
    },
  };
}

/**
 * Validate a key configuration
 */
function validateKeyConfig(key: KeyConfig): void {
  if (!key.id || typeof key.id !== 'string') {
    throw new InvalidKeyConfigError(key.id ?? 'unknown', 'Key ID is required');
  }

  if (!key.value || typeof key.value !== 'string') {
    throw new InvalidKeyConfigError(key.id, 'Key value is required');
  }

  if (!key.quota) {
    throw new InvalidKeyConfigError(key.id, 'Quota configuration is required');
  }

  if (key.rps !== undefined && (typeof key.rps !== 'number' || key.rps <= 0)) {
    throw new InvalidKeyConfigError(key.id, 'RPS must be a positive number');
  }

  if (key.weight !== undefined && (typeof key.weight !== 'number' || key.weight <= 0)) {
    throw new InvalidKeyConfigError(key.id, 'Weight must be a positive number');
  }
}

/**
 * Create initial state for a key
 */
function createKeyState(key: KeyConfig): KeyState {
  const now = new Date();
  return {
    config: key,
    quotaUsed: 0,
    periodStart: now,
    rateLimitedUntil: null,
    circuitState: 'closed',
    circuitOpenUntil: null,
    consecutiveFailures: 0,
    lastUsed: null,
    tokens: key.rps ?? 0,
    lastTokenRefill: now,
  };
}

/**
 * Build key stats from state
 */
function buildKeyStats(
  state: KeyState,
  rateLimiter: RateLimiter,
  quotaTracker: QuotaTracker,
  circuitBreaker: CircuitBreaker
): KeyStats {
  return {
    id: state.config.id,
    quotaUsed: state.quotaUsed,
    quotaRemaining: quotaTracker.getRemaining(state),
    isRateLimited:
      !rateLimiter.hasCapacity(state) ||
      (state.rateLimitedUntil !== null && state.rateLimitedUntil.getTime() > Date.now()),
    isCircuitOpen: circuitBreaker.getState(state) === 'open',
    isExhausted: !quotaTracker.hasQuota(state),
    currentRps: rateLimiter.getCurrentRps(state),
    rpsLimit: state.config.rps ?? null,
    consecutiveFailures: state.consecutiveFailures,
  };
}
