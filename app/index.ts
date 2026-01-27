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

// Storage adapters
export { memoryAdapter, MemoryStorageAdapter } from './storage/memory.js';
export {
  dockerAdapter,
  DockerStorageAdapter,
} from './storage/docker.js';
export type { StorageAdapterOptions } from './storage/types.js';
export type { DockerStorageAdapterOptions } from './storage/docker.js';
