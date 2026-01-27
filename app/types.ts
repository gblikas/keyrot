/**
 * Configuration for a single API key in the pool
 */
export interface KeyConfig {
  /** Unique identifier for this key */
  id: string;
  /** The actual API key value */
  value: string;
  /** Quota configuration for this key */
  quota: QuotaConfig;
  /** Requests per second limit (optional) */
  rps?: number;
  /** Priority weight for key selection (default: 1) */
  weight?: number;
}

/**
 * Quota configuration - defines usage limits for a key
 */
export type QuotaConfig =
  | { type: 'monthly'; limit: number }
  | { type: 'yearly'; limit: number }
  | { type: 'total'; limit: number }
  | { type: 'unlimited' };

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit (default: 60000) */
  resetTimeoutMs: number;
}

/**
 * Options for a single execute() call
 */
export interface ExecuteOptions {
  /** Maximum time to wait in queue (ms). Throws QueueTimeoutError if exceeded */
  maxWaitMs?: number;
}

/**
 * Configuration for creating a key pool
 */
export interface PoolConfig<TResponse = Response> {
  /** Array of API keys to include in the pool */
  keys: KeyConfig[];

  // Response handling callbacks
  /** Detect rate limit responses (e.g., 429 status) */
  isRateLimited?: (response: TResponse) => boolean;
  /** Detect error responses that should trigger key rotation (e.g., 500s, timeouts) */
  isError?: (response: TResponse) => boolean;
  /** Extract retry-after value from response (in seconds) */
  getRetryAfter?: (response: TResponse) => number | null;
  /** Extract remaining quota from response headers for sync */
  getQuotaRemaining?: (response: TResponse) => number | null;
  /** Detect successful responses */
  isSuccess?: (response: TResponse) => boolean;

  // Queue behavior
  /** Maximum number of pending requests in queue (default: 1000) */
  maxQueueSize?: number;
  /** Default max wait time for requests in queue (default: 30000ms) */
  defaultMaxWaitMs?: number;

  // Retry behavior
  /** Maximum retry attempts across different keys (default: keys.length) */
  maxRetries?: number;
  /** Quota usage percentage that triggers warning (default: 0.8) */
  warningThreshold?: number;

  // Circuit breaker
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig;

  // Storage
  /** Storage adapter for persisting state (default: in-memory) */
  storage?: StorageAdapter;

  // Callbacks
  /** Called when a key reaches the warning threshold */
  onWarning?: (key: KeyConfig, usagePercent: number) => void;
  /** Called when a key's quota is exhausted */
  onKeyExhausted?: (key: KeyConfig) => void;
  /** Called when a key's circuit breaker opens */
  onKeyCircuitOpen?: (key: KeyConfig) => void;
  /** Called when all keys are exhausted */
  onAllKeysExhausted?: () => void;
}

/**
 * Health status of the key pool
 */
export interface HealthStatus {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'critical' | 'exhausted';
  /** Number of keys currently available */
  availableKeys: number;
  /** Total number of keys in pool */
  totalKeys: number;
  /** Combined RPS capacity of available keys */
  effectiveRps: number;
  /** Combined remaining quota of available keys */
  effectiveQuotaRemaining: number;
  /** Combined total quota of all keys */
  effectiveQuotaTotal: number;
  /** Current warnings */
  warnings: HealthWarning[];
}

/**
 * A health warning for monitoring
 */
export interface HealthWarning {
  /** Key that triggered the warning */
  keyId: string;
  /** Type of warning */
  type: 'quota_warning' | 'rate_limited' | 'circuit_open' | 'quota_exhausted';
  /** Human-readable message */
  message: string;
  /** Timestamp when warning was generated */
  timestamp: Date;
}

/**
 * Statistics for a single key
 */
export interface KeyStats {
  /** Key identifier */
  id: string;
  /** Quota used in current period */
  quotaUsed: number;
  /** Quota remaining in current period */
  quotaRemaining: number;
  /** Whether key is currently rate limited */
  isRateLimited: boolean;
  /** Whether key's circuit breaker is open */
  isCircuitOpen: boolean;
  /** Whether key's quota is exhausted */
  isExhausted: boolean;
  /** Current RPS usage */
  currentRps: number;
  /** Configured RPS limit */
  rpsLimit: number | null;
  /** Consecutive failure count */
  consecutiveFailures: number;
}

/**
 * Storage adapter interface for persisting pool state
 */
export interface StorageAdapter {
  /** Get a value by key */
  get(key: string): Promise<string | null>;
  /** Set a value with optional TTL (in seconds) */
  set(key: string, value: string, ttl?: number): Promise<void>;
  /** Delete a value */
  delete(key: string): Promise<void>;
}

/**
 * Internal state for a key
 */
export interface KeyState {
  /** Key configuration */
  config: KeyConfig;
  /** Quota used in current period */
  quotaUsed: number;
  /** Quota period start timestamp */
  periodStart: Date;
  /** Whether currently rate limited */
  rateLimitedUntil: Date | null;
  /** Circuit breaker state */
  circuitState: 'closed' | 'open' | 'half-open';
  /** Circuit open until (if open) */
  circuitOpenUntil: Date | null;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Last used timestamp */
  lastUsed: Date | null;
  /** Token bucket state for RPS limiting */
  tokens: number;
  /** Last token refill timestamp */
  lastTokenRefill: Date;
}

/**
 * Request in the queue
 */
export interface QueuedRequest<TResponse> {
  /** Unique request ID */
  id: string;
  /** The request function to execute */
  execute: (keyValue: string) => Promise<TResponse>;
  /** Resolve the promise */
  resolve: (value: TResponse) => void;
  /** Reject the promise */
  reject: (error: Error) => void;
  /** When the request was queued */
  queuedAt: Date;
  /** Maximum wait time */
  maxWaitMs: number;
  /** Retry count */
  retryCount: number;
}
