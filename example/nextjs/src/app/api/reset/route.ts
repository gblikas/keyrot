import { NextResponse } from 'next/server';
import { resetPool } from '@/lib/pool';

export async function POST() {
  resetPool();
  
  return NextResponse.json({
    success: true,
    message: 'Pool reset',
  });
}
