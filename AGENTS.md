# AGENTS.md

This file provides guidance for AI agents working on the keyrot codebase.

## Project Overview

**keyrot** is a TypeScript library for API key rotation and multiplexing. It manages multiple API keys as a unified pool with automatic rate limiting, quota tracking, circuit breaker patterns, and health monitoring.

### Key Features

- **Key Pool Management**: Manage multiple API keys as a single pool
- **Rate Limiting**: Per-key RPS (requests per second) limiting with token bucket algorithm
- **Quota Tracking**: Monthly, yearly, total, or unlimited quota configurations
- **Circuit Breaker**: Automatic failure detection and recovery
- **Health Monitoring**: Real-time health status (healthy, degraded, critical, exhausted)
- **Request Queue**: Automatic queuing with timeout support

## Project Structure

```
/workspace/
├── app/                    # Main library source code
│   ├── index.ts           # Public exports
│   ├── pool.ts            # Main KeyPool implementation
│   ├── types.ts           # TypeScript interfaces and types
│   ├── errors.ts          # Custom error classes
│   ├── rate-limiter.ts    # RPS limiting logic
│   ├── quota-tracker.ts   # Quota management
│   ├── circuit-breaker.ts # Circuit breaker pattern
│   ├── selector.ts        # Key selection strategy
│   ├── queue.ts           # Request queue
│   ├── executor.ts        # Request execution
│   ├── health.ts          # Health monitoring
│   └── storage/           # Storage adapters
│       ├── types.ts
│       └── memory.ts
├── tests/                  # Test files (Vitest)
├── example/nextjs/         # Example Next.js application
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Development Commands

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests (watch mode)
npm test

# Run tests once
npm run test:run

# Type checking
npm run typecheck

# Lint the code
npm run lint

# Clean build artifacts
npm run clean
```

## Code Style and Conventions

### TypeScript

- Target: ES2022
- Module system: ESM (NodeNext)
- Strict mode enabled with additional strict flags:
  - `noUnusedLocals`
  - `noUnusedParameters`
  - `noFallthroughCasesInSwitch`
  - `exactOptionalPropertyTypes`

### File Extensions

- Use `.js` extensions in imports (ESM requirement)
- Example: `import { RateLimiter } from './rate-limiter.js';`

### Error Handling

- All custom errors extend `KeyrotError`
- Include actionable information in errors (e.g., `retryAfterMs`, `queueSize`)
- Error classes are in `app/errors.ts`

### Type Definitions

- All public types are defined in `app/types.ts`
- Export types from `app/index.ts` for public consumption
- Use `satisfies` for type-safe default values

## Testing Guidelines

### Framework

Tests use **Vitest** with the following configuration:
- Tests are in `tests/` directory with `.test.ts` extension
- Globals enabled (no need to import `describe`, `it`, `expect`)
- Node environment

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ComponentName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should do something', async () => {
    // Test implementation
  });
});
```

### Async Testing

- Use `vi.useFakeTimers()` for time-dependent tests
- Use `await vi.runAllTimersAsync()` to advance timers
- Clean up pools with `pool.shutdown()` in `afterEach`
- Use helper functions to silence expected rejections:
  ```typescript
  function silenceRejection(promise: Promise<unknown>): void {
    promise.catch(() => {});
  }
  ```

### Test Organization

Each component has its own test file:
- `pool.test.ts` - Main pool functionality
- `circuit-breaker.test.ts` - Circuit breaker logic
- `rate-limiter.test.ts` - Rate limiting
- `quota-tracker.test.ts` - Quota management
- `queue.test.ts` - Request queue
- `selector.test.ts` - Key selection
- `storage.test.ts` - Storage adapters
- `errors.test.ts` - Error classes

## Architecture Notes

### Request Flow

1. `pool.execute(fn)` enqueues request
2. `RequestQueue` manages FIFO queue with timeout
3. `Executor` picks available key via `KeySelector`
4. `KeySelector` checks:
   - Rate limiter capacity
   - Quota availability
   - Circuit breaker state
5. Request executes with selected key
6. Response handlers update state (quota, rate limits, circuit)
7. On failure, retry with different key

### Key Selection Priority

Keys are selected based on:
1. Availability (not rate-limited, not circuit-open, has quota)
2. Weight (higher weight = higher priority)
3. Last used time (least recently used preferred)

### Circuit Breaker States

- **Closed**: Normal operation
- **Open**: Failures exceeded threshold, requests blocked
- **Half-Open**: After timeout, allows test request

## Common Patterns

### Creating a Key Pool

```typescript
const pool = createKeyPool({
  keys: [
    { id: 'key-1', value: 'sk-xxx', quota: { type: 'monthly', limit: 10000 }, rps: 10 },
    { id: 'key-2', value: 'sk-yyy', quota: { type: 'unlimited' }, rps: 5 },
  ],
  isRateLimited: (res) => res.status === 429,
  isError: (res) => res.status >= 500,
  getRetryAfter: (res) => parseInt(res.headers.get('retry-after') ?? '60'),
});
```

### Executing Requests

```typescript
const response = await pool.execute(async (keyValue) => {
  return fetch('https://api.example.com', {
    headers: { Authorization: `Bearer ${keyValue}` },
  });
});
```

### Hot Module Reloading (HMR) Considerations

When using keyrot in frameworks with hot module reloading (Next.js, Vite, Remix, etc.), you must use the `globalThis` pattern to preserve the pool singleton across module reloads. Otherwise, the pool will be recreated during development, causing quota tracking and other state to reset unexpectedly.

**Incorrect (pool resets on HMR):**

```typescript
let pool: KeyPool<Response> | null = null;

export function getPool() {
  if (!pool) {
    pool = createKeyPool({ ... });
  }
  return pool;
}
```

**Correct (pool survives HMR):**

```typescript
const globalForPool = globalThis as unknown as {
  keyrotPool: KeyPool<Response> | undefined;
};

export function getPool() {
  if (!globalForPool.keyrotPool) {
    globalForPool.keyrotPool = createKeyPool({ ... });
  }
  return globalForPool.keyrotPool;
}
```

This is the same pattern used by Prisma, Drizzle, and other libraries that require singletons. See the Next.js example in `example/nextjs/src/lib/pool.ts` for a complete implementation.

### Storage Considerations

The library supports pluggable storage adapters for persisting quota state:

- **In-memory storage (default)**: State is lost on application restart. Suitable for development and testing.
- **Persistent storage**: For production, implement a custom `StorageAdapter` (e.g., Redis, file-based) to persist quota state across restarts.

The library automatically awaits state loading from storage before processing requests, ensuring quota tracking is accurate even when the first request arrives immediately after pool creation.

```typescript
// Example with custom storage adapter
const pool = createKeyPool({
  keys: [...],
  storage: myRedisAdapter, // Implements StorageAdapter interface
});
```

## Example Application

The repository includes a Next.js example application in `example/nextjs/` that demonstrates how to use keyrot.

### Local Package Dependency

The Next.js example depends on the core keyrot package via a local file reference:

```json
{
  "dependencies": {
    "keyrot": "file:../.."
  }
}
```

This means the core keyrot package must be built (`npm run build` in root) before the example can be used.

### Building the Example

From the `example/nextjs/` directory:

```bash
# Install dependencies (if not already installed)
npm install

# Build (automatically builds keyrot first, then Next.js)
npm run build

# Run in development mode
npm run dev
```

The example's build script (`npm run build`) automatically:
1. Navigates to the root directory and builds keyrot (`npm run build:keyrot`)
2. Runs `next build` to build the Next.js application

### Vercel Deployment

The example includes a `vercel.json` configuration for proper deployment:

```json
{
  "installCommand": "cd ../.. && npm install && cd example/nextjs && npm install",
  "buildCommand": "npm run build",
  "outputDirectory": ".next"
}
```

When deploying to Vercel:
1. Set the **Root Directory** to `example/nextjs`
2. Vercel will use the custom install command to:
   - Install root package dependencies (including tsup for building keyrot)
   - Install Next.js example dependencies
3. The build command will build keyrot first, then the Next.js app

### Running the Example Locally

```bash
# From the repository root
cd example/nextjs

# Install all dependencies (root + example)
cd ../.. && npm install && cd example/nextjs && npm install

# Start development server
npm run dev
```

## Important Notes for Agents

1. **Always run tests** after making changes: `npm run test:run`
2. **Check types** before committing: `npm run typecheck`
3. **Run linting** on app code: `npm run lint`
4. **Maintain backward compatibility** for public API in `app/index.ts`
5. **Update tests** when modifying functionality
6. **Use ESM imports** with `.js` extension in import paths
7. **Handle async properly** - the library is heavily async/promise-based
8. **Consider edge cases** - rate limiting, quota exhaustion, circuit breaker states
9. **Build keyrot before testing the example**: The Next.js example requires the core package to be built first
