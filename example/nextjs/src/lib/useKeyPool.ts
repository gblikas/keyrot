'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createKeyPool, type KeyPool, memoryAdapter, type StorageAdapter } from '@gblikas/keyrot/client';

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
function getKeyIdFromValue(value: string): string {
  return KEY_VALUE_TO_ID.get(value) ?? value;
}

/**
 * Result type that wraps a response with the key ID used
 */
export interface ApiResult {
  response: Response;
  keyId: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'critical' | 'exhausted';
  availableKeys: number;
  totalKeys: number;
  effectiveRps: number;
  effectiveQuotaRemaining: number;
  effectiveQuotaTotal: number;
  warnings: Array<{
    keyId: string;
    type: string;
    message: string;
  }>;
}

export interface KeyStats {
  id: string;
  quotaUsed: number;
  quotaRemaining: number;
  isRateLimited: boolean;
  isCircuitOpen: boolean;
  isExhausted: boolean;
  currentRps: number;
  rpsLimit: number | null;
  consecutiveFailures: number;
}

export interface RequestResult {
  id: string;
  success: boolean;
  keyUsed?: string;
  duration?: number;
  error?: string;
  health?: HealthStatus;
  timestamp: number;
}

interface SimulateOptions {
  simulate429?: boolean;
  simulate500?: boolean;
}

/**
 * Simulated external API call
 * In a real app, this would be a call to OpenAI, Anthropic, etc.
 */
async function simulateApiCall(
  apiKey: string,
  options: SimulateOptions
): Promise<ApiResult> {
  // Get the key ID for display purposes
  const keyId = getKeyIdFromValue(apiKey);
  
  // Simulate network latency
  await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
  
  // Simulate 429 rate limit
  if (options.simulate429) {
    return {
      response: new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      }),
      keyId,
    };
  }
  
  // Simulate 500 server error
  if (options.simulate500) {
    return {
      response: new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      keyId,
    };
  }
  
  // Simulate successful response
  return {
    response: new Response(JSON.stringify({
      message: 'Success',
      keyId,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    keyId,
  };
}

// Store pool and storage on window to survive React hot reloads
const getGlobalPool = (): { pool: KeyPool<ApiResult> | null; storage: StorageAdapter | null } => {
  if (typeof window === 'undefined') {
    return { pool: null, storage: null };
  }
  
  const win = window as unknown as {
    __keyrotPool?: KeyPool<ApiResult>;
    __keyrotStorage?: StorageAdapter;
  };
  
  return {
    pool: win.__keyrotPool ?? null,
    storage: win.__keyrotStorage ?? null,
  };
};

const setGlobalPool = (pool: KeyPool<ApiResult> | null, storage: StorageAdapter | null) => {
  if (typeof window === 'undefined') return;
  
  const win = window as unknown as {
    __keyrotPool?: KeyPool<ApiResult>;
    __keyrotStorage?: StorageAdapter;
  };
  
  if (pool) {
    win.__keyrotPool = pool;
  } else {
    delete win.__keyrotPool;
  }
  
  if (storage) {
    win.__keyrotStorage = storage;
  } else {
    delete win.__keyrotStorage;
  }
};

/**
 * Create or get the key pool instance
 */
function getOrCreatePool(): KeyPool<ApiResult> {
  let { pool, storage } = getGlobalPool();
  
  if (!pool) {
    // Create storage if it doesn't exist
    if (!storage) {
      storage = memoryAdapter();
    }
    
    pool = createKeyPool<ApiResult>({
      keys: DEMO_KEYS,
      storage,
      
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
    
    setGlobalPool(pool, storage);
  }
  
  return pool;
}

/**
 * Reset the pool (for testing/demo purposes)
 */
function resetPoolInstance(): void {
  const { pool } = getGlobalPool();
  if (pool) {
    void pool.shutdown();
  }
  setGlobalPool(null, null);
}

/**
 * Hook to manage the key pool on the client side
 */
export function useKeyPool() {
  const poolRef = useRef<KeyPool<ApiResult> | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [keyStats, setKeyStats] = useState<KeyStats[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Initialize pool on mount
  useEffect(() => {
    poolRef.current = getOrCreatePool();
    setIsReady(true);
    
    // Initial health fetch
    updateHealth();
    
    // Poll health every second
    const interval = setInterval(updateHealth, 1000);
    
    return () => {
      clearInterval(interval);
    };
  }, []);

  const updateHealth = useCallback(() => {
    const pool = poolRef.current;
    if (!pool) return;
    
    const healthData = pool.getHealth();
    const statsData = pool.getAllKeyStats();
    
    setHealth(healthData);
    setKeyStats(statsData);
  }, []);

  const makeRequest = useCallback(async (options: SimulateOptions = {}): Promise<RequestResult> => {
    const pool = poolRef.current;
    if (!pool) {
      return {
        id: `req-${Date.now()}`,
        success: false,
        error: 'Pool not initialized',
        timestamp: Date.now(),
      };
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const startTime = Date.now();

    try {
      const result = await pool.execute(
        async (keyValue) => simulateApiCall(keyValue, options),
        { maxWaitMs: 5000 }
      );

      const duration = Date.now() - startTime;
      const healthData = pool.getHealth();

      // Update health after request
      updateHealth();

      return {
        id: requestId,
        success: true,
        keyUsed: result.keyId,
        duration,
        health: healthData,
        timestamp: Date.now(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const healthData = pool.getHealth();

      // Update health after request
      updateHealth();

      // Handle specific error types
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Check for specific keyrot error types by name
        if (error.name === 'QueueTimeoutError') {
          const err = error as Error & { waitedMs?: number; retryAfterMs?: number };
          errorMessage = `Queue timeout after ${err.waitedMs ?? 0}ms`;
        } else if (error.name === 'AllKeysExhaustedError') {
          const err = error as Error & { exhaustedKeys?: number; circuitOpenKeys?: number; rateLimitedKeys?: number };
          errorMessage = `All keys exhausted (${err.exhaustedKeys ?? 0} exhausted, ${err.circuitOpenKeys ?? 0} circuits open, ${err.rateLimitedKeys ?? 0} rate limited)`;
        } else if (error.name === 'QueueFullError') {
          const err = error as Error & { queueSize?: number; maxQueueSize?: number };
          errorMessage = `Queue full (${err.queueSize ?? 0}/${err.maxQueueSize ?? 0})`;
        }
      }

      return {
        id: requestId,
        success: false,
        error: errorMessage,
        duration,
        health: healthData,
        timestamp: Date.now(),
      };
    }
  }, [updateHealth]);

  const burstRequests = useCallback(async (count: number): Promise<RequestResult[]> => {
    const promises = Array.from({ length: count }, () => makeRequest());
    const results = await Promise.all(promises);
    
    // Sort by timestamp (most recent first)
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    return results;
  }, [makeRequest]);

  const resetPool = useCallback(() => {
    resetPoolInstance();
    poolRef.current = getOrCreatePool();
    updateHealth();
  }, [updateHealth]);

  return {
    isReady,
    health,
    keyStats,
    makeRequest,
    burstRequests,
    resetPool,
    updateHealth,
  };
}
