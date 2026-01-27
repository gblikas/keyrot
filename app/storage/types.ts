import type { StorageAdapter } from '../types.js';

export type { StorageAdapter };

/**
 * Options for creating a storage adapter
 */
export interface StorageAdapterOptions {
  /** Prefix for all keys (useful for namespacing) */
  prefix?: string;
}
