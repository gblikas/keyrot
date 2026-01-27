import { createKeyPool, type KeyPool } from 'keyrot';

/**
 * Simulated API keys for demonstration
 * In production, these would come from environment variables
 */
const DEMO_KEYS = [
  {
    id: 'key-1',
    value: 'demo-api-key-001',
    quota: { type: 'monthly' as const, limit: 1000 },
    rps: 10,
  },
  {
    id: 'key-2',
    value: 'demo-api-key-002',
    quota: { type: 'monthly' as const, limit: 1000 },
    rps: 10,
  },
  {
    id: 'key-3',
    value: 'demo-api-key-003',
    quota: { type: 'monthly' as const, limit: 500 },
    rps: 5,
  },
];

/**
 * Mapping from key values to key IDs for display purposes
 */
const KEY_VALUE_TO_ID = new Map(DEMO_KEYS.map(k => [k.value, k.id]));

/**
 * Get the key ID from a key value
 */
export function getKeyIdFromValue(value: string): string {
  return KEY_VALUE_TO_ID.get(value) ?? value;
}

/**
 * Result type that wraps a response with the key ID used
 */
export interface ApiResult {
  response: Response;
  keyId: string;
}

/**
 * Use globalThis to preserve the pool singleton across Next.js hot module reloading (HMR).
 * Without this, the pool would be recreated when the module reloads during development,
 * causing quota tracking and other state to reset unexpectedly.
 * 
 * This is the same pattern used by Prisma, Drizzle, and other libraries that require singletons.
 */
const globalForPool = globalThis as unknown as {
  keyrotPool: KeyPool<ApiResult> | undefined;
};

/**
 * Get or create the key pool instance
 */
export function getPool(): KeyPool<ApiResult> {
  if (!globalForPool.keyrotPool) {
    globalForPool.keyrotPool = createKeyPool<ApiResult>({
      keys: DEMO_KEYS,
      
      // Detect rate limiting (429 status)
      isRateLimited: (result) => result.response.status === 429,
      
      // Detect server errors that should trigger key rotation
      isError: (result) => result.response.status >= 500,
      
      // Extract retry-after header
      getRetryAfter: (result) => {
        const header = result.response.headers.get('retry-after');
        if (header) {
          const seconds = parseInt(header, 10);
          return isNaN(seconds) ? 60 : seconds;
        }
        return null;
      },
      
      // Queue settings
      maxQueueSize: 100,
      defaultMaxWaitMs: 10000,
      
      // Warning threshold
      warningThreshold: 0.8,
      
      // Circuit breaker
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 30000,
      },
      
      // Callbacks for logging
      onWarning: (key, usage) => {
        console.log(`[keyrot] Warning: Key "${key.id}" at ${(usage * 100).toFixed(1)}% quota usage`);
      },
      onKeyExhausted: (key) => {
        console.log(`[keyrot] Key "${key.id}" quota exhausted`);
      },
      onKeyCircuitOpen: (key) => {
        console.log(`[keyrot] Key "${key.id}" circuit opened due to failures`);
      },
      onAllKeysExhausted: () => {
        console.log('[keyrot] All keys exhausted!');
      },
    });
  }
  
  return globalForPool.keyrotPool;
}

/**
 * Reset the pool (for testing/demo purposes)
 */
export function resetPool(): void {
  if (globalForPool.keyrotPool) {
    void globalForPool.keyrotPool.shutdown();
    globalForPool.keyrotPool = undefined;
  }
}
