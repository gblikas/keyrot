import { NextResponse } from 'next/server';
import { getPool } from '@/lib/pool';

export async function GET() {
  const pool = getPool();
  
  return NextResponse.json({
    health: pool.getHealth(),
    keyStats: pool.getAllKeyStats(),
    queueSize: pool.getQueueSize(),
  });
}
