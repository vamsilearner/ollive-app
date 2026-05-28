/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { chatRequestSchema } from "@/src/sdk/validation";
import { db } from "@/src/lib/db";
import { messages, sessions } from "@/src/lib/schema";
import { eq } from "drizzle-orm";
import { dispatchLog, getProvider } from "@/src/sdk";
import { InferenceMetadata } from "@/src/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function loadEnv() {
  try {
    const envPath = join(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  } catch {
    // .env not found, rely on existing env vars
  }
}

const encoder = new TextEncoder();

export async function POST(request: NextRequest) {
  // Load .env on every request to ensure env vars are available
  loadEnv();

  try {
    const body = await request.json();
    const parsed = chatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { message, sessionId, provider, model, history } = parsed.data;

    // Get or create session
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const now = new Date().toISOString();
      const [newSession] = await db
        .insert(sessions)
        .values({
          id: crypto.randomUUID(),
          title: message.slice(0, 50),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      currentSessionId = newSession.id;
    } else {
      // Verify session exists and is active
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, currentSessionId),
      });
      if (!session || session.status === "cancelled") {
        return NextResponse.json(
          { error: "Session not found or cancelled" },
          { status: 404 },
        );
      }
      // Update session title if it's the default
      if (session.title === "New Conversation") {
        await db
          .update(sessions)
          .set({
            title: message.slice(0, 50),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(sessions.id, currentSessionId));
      }
    }

    // Save user message
    const [userMsg] = await db
      .insert(messages)
      .values({
        id: crypto.randomUUID(),
        sessionId: currentSessionId,
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      })
      .returning();

    // Build messages array for LLM
    const llmMessages = [
      ...history.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    // Get provider
    let finalProvider;
    let finalProviderName: string;
    let targetModel: string;

    try {
      const {
        provider: llmProvider,
        name: providerName,
        model: defaultModel,
      } = getProvider();
      targetModel = model || defaultModel;
      finalProvider = llmProvider;
      finalProviderName = providerName;

      // If a specific provider was requested and available, use it
      if (provider) {
        const { createProvider } = await import("@/src/sdk");
        const apiKeyMap: Record<string, string | undefined> = {
          google: process.env.GEMINI_API_KEY,
          openai: process.env.OPENAI_API_KEY,
          anthropic: process.env.ANTHROPIC_API_KEY,
        };
        const apiKey = apiKeyMap[provider];
        if (apiKey) {
          finalProvider = createProvider(provider, apiKey);
          finalProviderName = provider;
        }
      }
    } catch (envError: any) {
      return NextResponse.json(
        { error: envError.message || "Environment configuration error" },
        { status: 500 },
      );
    }

    // Stream the response from the LLM provider
    const { stream, metadata: metadataPromise } =
      await finalProvider.chatStream(llmMessages, {
        model: targetModel,
        signal: request.signal,
      });

    // Handle saving metadata asynchronously after stream pipeline completes
    metadataPromise
      .then(async (metadata: InferenceMetadata) => {
        // Save assistant message
        const [assistantMsg] = await db
          .insert(messages)
          .values({
            id: crypto.randomUUID(),
            sessionId: currentSessionId,
            role: "assistant",
            content: metadata.outputPreview,
            createdAt: new Date().toISOString(),
          })
          .returning();

        // Dispatch inference log
        dispatchLog(currentSessionId, assistantMsg.id, metadata);

        // Update session timestamp
        await db
          .update(sessions)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(sessions.id, currentSessionId));
      })
      .catch(console.error);

    // Get a reader from the underlying LLM chunk stream
    const reader = stream.getReader();

    // Create a native underlying stream to pipe tokens to the response object directly
    const nativeResponseStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            // Enqueue chunks to keep pipeline active
            controller.enqueue(
              typeof value === "string" ? encoder.encode(value) : value,
            );
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (err.name !== "AbortError") {
            console.error("Stream reader execution error:", err.message);
            // Send error message to client
            controller.enqueue(encoder.encode(`Error: ${err.message}`));
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    // Define response streaming transmission headers
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("Connection", "keep-alive");
    responseHeaders.set("X-Accel-Buffering", "no"); // Prevents Nginx/Vercel proxies from caching blocks

    // Set debugging/tracking custom session indicators
    responseHeaders.set("X-Session-Id", currentSessionId);
    responseHeaders.set("X-Message-Id", userMsg.id);
    responseHeaders.set("X-Provider", finalProviderName);
    responseHeaders.set("X-Model", targetModel);

    return new Response(nativeResponseStream, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
