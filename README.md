# keyrot

API key rotation and multiplexing library for TypeScript. Manage multiple API keys as a unified pool with automatic rate limiting, quota tracking, circuit breaker patterns, and health monitoring.

## Features

- **Key Pool Management** - Manage multiple API keys as a single unified pool
- **Rate Limiting** - Per-key RPS (requests per second) limiting with token bucket algorithm
- **Quota Tracking** - Monthly, yearly, total, or unlimited quota configurations with automatic period resets
- **Circuit Breaker** - Automatic failure detection and recovery to prevent cascading failures
- **Health Monitoring** - Real-time health status (healthy, degraded, critical, exhausted)
- **Request Queue** - Automatic queuing with timeout support when all keys are temporarily unavailable
- **Persistent Storage** - Pluggable storage adapters for persisting quota state across restarts
- **Automatic Retry** - Smart retry logic with key rotation on failures

## Installation

```bash
npm install @gblikas/keyrot
```

## Quick Start

```typescript
import { createKeyPool } from '@gblikas/keyrot';

const pool = createKeyPool({
  keys: [
    { 
      id: 'key-1', 
      value: 'sk-xxx', 
      quota: { type: 'monthly', limit: 10000 }, 
      rps: 10 
    },
    { 
      id: 'key-2', 
      value: 'sk-yyy', 
      quota: { type: 'unlimited' }, 
      rps: 5 
    },
  ],
  isRateLimited: (res) => res.status === 429,
  isError: (res) => res.status >= 500,
  getRetryAfter: (res) => parseInt(res.headers.get('retry-after') ?? '60'),
});

// Execute requests through the pool
const response = await pool.execute(async (keyValue) => {
  return fetch('https://api.example.com', {
    headers: { Authorization: `Bearer ${keyValue}` },
  });
});
```

## API Reference

### `createKeyPool<TResponse>(config: PoolConfig<TResponse>): KeyPool<TResponse>`

Creates a new key pool instance.

#### Configuration Options

```typescript
interface PoolConfig<TResponse> {
  // Required
  keys: KeyConfig[];                    // Array of API keys

  // Response handling (optional)
  isRateLimited?: (res: TResponse) => boolean;   // Detect 429 responses
  isError?: (res: TResponse) => boolean;         // Detect error responses
  isSuccess?: (res: TResponse) => boolean;       // Detect successful responses
  getRetryAfter?: (res: TResponse) => number | null;  // Extract retry-after (seconds)
  getQuotaRemaining?: (res: TResponse) => number | null;  // Sync quota from headers

  // Queue behavior (optional)
  maxQueueSize?: number;               // Max pending requests (default: 1000)
  defaultMaxWaitMs?: number;           // Default queue timeout (default: 30000ms)

  // Retry behavior (optional)
  maxRetries?: number;                 // Max retries across keys (default: keys.length)
  warningThreshold?: number;           // Quota warning threshold (default: 0.8)

  // Circuit breaker (optional)
  circuitBreaker?: {
    failureThreshold: number;          // Failures before opening (default: 5)
    resetTimeoutMs: number;            // Time before half-open (default: 60000)
  };

  // Storage (optional)
  storage?: StorageAdapter;            // Persistence adapter (default: in-memory)

  // Callbacks (optional)
  onWarning?: (key: KeyConfig, usagePercent: number) => void;
  onKeyExhausted?: (key: KeyConfig) => void;
  onKeyCircuitOpen?: (key: KeyConfig) => void;
  onAllKeysExhausted?: () => void;
}
```

#### Key Configuration

```typescript
interface KeyConfig {
  id: string;           // Unique identifier
  value: string;        // The actual API key
  quota: QuotaConfig;   // Quota configuration
  rps?: number;         // Requests per second limit
  weight?: number;      // Priority weight (default: 1)
}

type QuotaConfig =
  | { type: 'monthly'; limit: number }
  | { type: 'yearly'; limit: number }
  | { type: 'total'; limit: number }
  | { type: 'unlimited' };
```

### Pool Methods

#### `execute(fn, options?): Promise<TResponse>`

Execute a request through the pool. The pool automatically selects an available key, handles retries, and manages quotas.

```typescript
const response = await pool.execute(
  async (keyValue) => {
    return fetch(url, { headers: { Authorization: `Bearer ${keyValue}` } });
  },
  { maxWaitMs: 5000 }  // Optional: override default queue timeout
);
```

#### `getHealth(): HealthStatus`

Get the current health status of the pool.

```typescript
const health = pool.getHealth();
// {
//   status: 'healthy' | 'degraded' | 'critical' | 'exhausted',
//   availableKeys: 2,
//   totalKeys: 3,
//   effectiveRps: 15,
//   effectiveQuotaRemaining: 8500,
//   effectiveQuotaTotal: 10000,
//   warnings: [...]
// }
```

#### `getKeyStats(keyId): KeyStats | null`

Get statistics for a specific key.

```typescript
const stats = pool.getKeyStats('key-1');
// {
//   id: 'key-1',
//   quotaUsed: 1500,
//   quotaRemaining: 8500,
//   isRateLimited: false,
//   isCircuitOpen: false,
//   isExhausted: false,
//   currentRps: 3,
//   rpsLimit: 10,
//   consecutiveFailures: 0
// }
```

#### `getAllKeyStats(): KeyStats[]`

Get statistics for all keys in the pool.

#### `getQueueSize(): number`

Get the current number of pending requests in the queue.

#### `addKey(key): void`

Dynamically add a new key to the pool.

```typescript
pool.addKey({
  id: 'key-3',
  value: 'sk-zzz',
  quota: { type: 'monthly', limit: 5000 },
  rps: 10
});
```

#### `removeKey(keyId): boolean`

Remove a key from the pool. Returns `true` if the key was found and removed.

#### `closeCircuit(keyId): boolean`

Force close a circuit breaker for a key, allowing requests to flow again.

#### `openCircuit(keyId): boolean`

Force open a circuit breaker for a key, blocking all requests to it.

#### `resetQuota(keyId): boolean`

Reset the quota counter for a key.

#### `shutdown(): Promise<void>`

Gracefully shutdown the pool, clearing the queue and rejecting pending requests.

## Storage Adapters

keyrot supports pluggable storage adapters for persisting quota state across application restarts.

### Built-in Adapters

#### Memory Adapter (Default)

```typescript
import { createKeyPool, memoryAdapter } from '@gblikas/keyrot';

const pool = createKeyPool({
  keys: [...],
  storage: memoryAdapter(),  // This is the default
});
```

#### File Adapter

```typescript
import { createKeyPool, fileAdapter } from '@gblikas/keyrot';

const pool = createKeyPool({
  keys: [...],
  storage: fileAdapter({ path: './keyrot-state.json' }),
});
```

#### Docker Adapter

For containerized environments where the file system may be ephemeral:

```typescript
import { createKeyPool, dockerAdapter } from '@gblikas/keyrot';

const pool = createKeyPool({
  keys: [...],
  storage: dockerAdapter({ 
    volumePath: '/data',
    filename: 'keyrot-state.json' 
  }),
});
```

### Custom Storage Adapter

Implement the `StorageAdapter` interface for custom storage backends (Redis, databases, etc.):

```typescript
interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

## Error Handling

keyrot provides specific error classes for different failure scenarios:

```typescript
import { 
  KeyrotError,           // Base error class
  QueueTimeoutError,     // Request timed out waiting in queue
  AllKeysExhaustedError, // All keys are unavailable
  QueueFullError,        // Queue is at max capacity
  InvalidKeyConfigError, // Invalid key configuration
  NoKeysConfiguredError, // No keys provided to pool
} from '@gblikas/keyrot';

try {
  await pool.execute(fn);
} catch (error) {
  if (error instanceof QueueTimeoutError) {
    console.log(`Timed out after ${error.maxWaitMs}ms, queue size: ${error.queueSize}`);
  } else if (error instanceof AllKeysExhaustedError) {
    console.log('All API keys are exhausted');
  }
}
```

## Framework Integration

### Next.js / Vite / HMR Environments

When using keyrot in frameworks with hot module reloading (HMR), use the `globalThis` pattern to preserve the pool singleton across module reloads:

```typescript
// lib/pool.ts
import { createKeyPool, KeyPool } from '@gblikas/keyrot';

const globalForPool = globalThis as unknown as {
  keyrotPool: KeyPool<Response> | undefined;
};

export function getPool() {
  if (!globalForPool.keyrotPool) {
    globalForPool.keyrotPool = createKeyPool({
      keys: [
        { id: 'key-1', value: process.env.API_KEY_1!, quota: { type: 'monthly', limit: 10000 }, rps: 10 },
      ],
      isRateLimited: (res) => res.status === 429,
      isError: (res) => res.status >= 500,
    });
  }
  return globalForPool.keyrotPool;
}
```

This pattern is commonly used by Prisma, Drizzle, and other libraries that require singletons.

## Health Monitoring

The pool provides real-time health monitoring:

```typescript
const health = pool.getHealth();

switch (health.status) {
  case 'healthy':
    // All keys available
    break;
  case 'degraded':
    // Some keys unavailable but pool is functional
    break;
  case 'critical':
    // Most keys unavailable, limited capacity
    break;
  case 'exhausted':
    // All keys exhausted, requests will fail
    break;
}

// Check for warnings
for (const warning of health.warnings) {
  console.log(`${warning.type}: ${warning.message} (key: ${warning.keyId})`);
}
```

## Circuit Breaker

The circuit breaker pattern protects against cascading failures:

1. **Closed** - Normal operation, requests flow through
2. **Open** - Failures exceeded threshold, requests are blocked for this key
3. **Half-Open** - After timeout, allows a test request to check if the key is healthy

```typescript
const pool = createKeyPool({
  keys: [...],
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 consecutive failures
    resetTimeoutMs: 60000,    // Try again after 1 minute
  },
  onKeyCircuitOpen: (key) => {
    console.log(`Circuit opened for key ${key.id}`);
  },
});
```

## Key Selection Strategy

Keys are selected based on:

1. **Availability** - Not rate-limited, circuit not open, has remaining quota
2. **Weight** - Higher weight keys are preferred
3. **Last Used** - Least recently used keys are preferred (load balancing)

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test

# Run tests once
npm run test:run

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.7.0 (for development)

## License

MIT
