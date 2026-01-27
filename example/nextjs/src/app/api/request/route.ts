import { NextRequest, NextResponse } from 'next/server';
import { getPool, getKeyIdFromValue } from '@/lib/pool';
import { QueueTimeoutError, AllKeysExhaustedError, QueueFullError } from 'keyrot';

/**
 * Simulated external API call
 * In a real app, this would be a call to OpenAI, Anthropic, etc.
 */
async function simulateApiCall(
  apiKey: string,
  options: { simulate429?: boolean; simulate500?: boolean }
): Promise<{ response: Response; keyId: string }> {
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const simulate429 = searchParams.get('simulate429') === 'true';
  const simulate500 = searchParams.get('simulate500') === 'true';
  
  const pool = getPool();
  const startTime = Date.now();
  
  try {
    // Execute request through the pool
    // We wrap the result to capture both the response and key ID
    const result = await pool.execute(
      async (keyValue) => {
        return simulateApiCall(keyValue, { simulate429, simulate500 });
      },
      { maxWaitMs: 5000 }
    );
    
    const duration = Date.now() - startTime;
    const health = pool.getHealth();
    
    return NextResponse.json({
      success: true,
      keyUsed: result.keyId,
      duration,
      health,
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const health = pool.getHealth();
    
    if (error instanceof QueueTimeoutError) {
      return NextResponse.json({
        success: false,
        error: `Queue timeout after ${error.waitedMs}ms`,
        retryAfterMs: error.retryAfterMs,
        duration,
        health,
      }, { status: 503 });
    }
    
    if (error instanceof AllKeysExhaustedError) {
      return NextResponse.json({
        success: false,
        error: `All keys exhausted (${error.exhaustedKeys} exhausted, ${error.circuitOpenKeys} circuits open, ${error.rateLimitedKeys} rate limited)`,
        retryAfterMs: error.retryAfterMs,
        duration,
        health,
      }, { status: 503 });
    }
    
    if (error instanceof QueueFullError) {
      return NextResponse.json({
        success: false,
        error: `Queue full (${error.queueSize}/${error.maxQueueSize})`,
        retryAfterMs: error.retryAfterMs,
        duration,
        health,
      }, { status: 503 });
    }
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration,
      health,
    }, { status: 500 });
  }
}
