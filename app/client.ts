/**
 * Client-only exports for keyrot
 * 
 * This entry point excludes Node.js-only modules (like DockerStorageAdapter)
 * and is safe to use in browser environments (React, Next.js client components, etc.)
 */

// Main exports
export { createKeyPool } from './pool.js';
export type { KeyPool } from './pool.js';

// Types
export type {
  KeyConfig,
  QuotaConfig,
  PoolConfig,
  ExecuteOptions,
  CircuitBreakerConfig,
  HealthStatus,
  HealthWarning,
  KeyStats,
  StorageAdapter,
} from './types.js';

// Errors
export {
  KeyrotError,
  QueueTimeoutError,
  AllKeysExhaustedError,
  QueueFullError,
  InvalidKeyConfigError,
  NoKeysConfiguredError,
} from './errors.js';

// Storage adapters (client-compatible only)
export { memoryAdapter, MemoryStorageAdapter } from './storage/memory.js';
export type { StorageAdapterOptions } from './storage/types.js';
