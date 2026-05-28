import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/lib/db';
import { sessions } from '@/src/lib/schema';
import { desc } from 'drizzle-orm';

export const runtime = 'nodejs';

// List all sessions
export async function GET() {
  try {
    const sessionList = await db
      .select({
        id: sessions.id,
        title: sessions.title,
        status: sessions.status,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.updatedAt));

    return NextResponse.json({ sessions: sessionList });
  } catch (error) {
    console.error('Sessions list error:', error);
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}

// Create a new session
export async function POST(request: NextRequest) {
  try {
    const { title } = await request.json();
    const now = new Date().toISOString();
    const [newSession] = await db
      .insert(sessions)
      .values({
        id: crypto.randomUUID(),
        title: title || 'New Conversation',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ session: newSession }, { status: 201 });
  } catch (error) {
    console.error('Session create error:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}
