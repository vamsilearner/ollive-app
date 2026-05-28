import { NextRequest, NextResponse } from 'next/server';
import { logPayloadSchema } from '@/src/sdk/validation';
import { db } from '@/src/lib/db';
import { inferenceLogs } from '@/src/lib/schema';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate payload
    const parsed = logPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid log payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      sessionId,
      messageId,
      provider,
      model,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
      throughputTokensPerSec,
      statusCode,
      errorMessage,
      inputPreview,
      outputPreview,
      timestamp,
    } = parsed.data;

    // Insert inference log
    await db.insert(inferenceLogs).values({
      id: crypto.randomUUID(),
      sessionId,
      messageId,
      provider,
      model,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
      throughputTokensPerSec: throughputTokensPerSec.toString(),
      statusCode,
      errorMessage: errorMessage || null,
      inputPreview,
      outputPreview,
      timestamp: timestamp.toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { error: 'Failed to process log' },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'ingestion' });
}
