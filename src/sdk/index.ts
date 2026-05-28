/* eslint-disable @typescript-eslint/no-explicit-any */
import { LLMProvider, ChatOptions } from "./provider";
import { InferenceMetadata, Message, Provider } from "@/types";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-3.5-turbo";
const DEFAULT_PROVIDER: Provider = "openrouter";

// Event-based log queue
type LogEvent = {
  type: "inference_log";
  payload: InferenceMetadata & { sessionId: string; messageId?: string };
};

const logQueue: LogEvent[] = [];
let logProcessor: Promise<void> | null = null;

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1/chat/completions";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<{ content: string; metadata: InferenceMetadata }> {
    const startTime = performance.now();

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "",
          "X-Title": "Ollive Chat",
        },
        body: JSON.stringify({
          model: options?.model || OPENROUTER_MODEL,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
        }),
      });

      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenRouter API error: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      const usage = data.usage;

      const metadata: InferenceMetadata = {
        provider: "openrouter",
        model: options?.model || OPENROUTER_MODEL,
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        throughputTokensPerSec: usage?.completion_tokens
          ? Math.round((usage.completion_tokens / latencyMs) * 1000 * 100) / 100
          : 0,
        statusCode: "SUCCESS",
        inputPreview: messages.map((m) => m.content).join("\n"),
        outputPreview: text,
      };

      return { content: text, metadata };
    } catch (error) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      const err = error instanceof Error ? error : new Error(String(error));

      const metadata: InferenceMetadata = {
        provider: "openrouter",
        model: options?.model || OPENROUTER_MODEL,
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        throughputTokensPerSec: 0,
        statusCode: "ERROR",
        errorMessage: err.message,
        inputPreview: messages.map((m) => m.content).join("\n"),
        outputPreview: "",
      };

      throw Object.assign(err, { metadata });
    }
  }

  async chatStream(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<{
    stream: ReadableStream<string>;
    metadata: Promise<InferenceMetadata>;
  }> {
    const startTime = performance.now();
    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    const apiKey = this.apiKey;
    const baseUrl = this.baseUrl;

    let resolveMetadata: (value: InferenceMetadata) => void;
    let rejectMetadata: (reason?: any) => void;

    const metadataPromise = new Promise<InferenceMetadata>(
      (resolve, reject) => {
        resolveMetadata = resolve;
        rejectMetadata = reject;
      },
    );

    const stream = new ReadableStream<string>({
      async start(controller) {
        try {
          const response = await fetch(baseUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "",
              "X-Title": "Ollive Chat",
            },
            body: JSON.stringify({
              model: options?.model || OPENROUTER_MODEL,
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              stream: true,
              temperature: options?.temperature ?? 0.7,
              max_tokens: options?.maxTokens,
            }),
            signal: options?.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `OpenRouter API error: ${response.status} - ${errorText}`,
            );
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          if (!reader) {
            throw new Error("No response body from OpenRouter");
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);
                  if (parsed.choices?.[0]?.delta?.content) {
                    const text = parsed.choices[0].delta.content;
                    fullText += text;
                    controller.enqueue(text);
                  }
                  if (parsed.usage) {
                    promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
                    completionTokens =
                      parsed.usage.completion_tokens ?? completionTokens;
                  }
                } catch {}
              }
            }
          }

          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          resolveMetadata({
            provider: "openrouter",
            model: options?.model || OPENROUTER_MODEL,
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            throughputTokensPerSec: completionTokens
              ? Math.round((completionTokens / latencyMs) * 1000 * 100) / 100
              : 0,
            statusCode: "SUCCESS",
            inputPreview: messages.map((m) => m.content).join("\n"),
            outputPreview: fullText,
          });
          controller.close();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          rejectMetadata(err);
          controller.enqueue(`Error: ${err.message}`);
          controller.close();
        }
      },
    });

    return { stream, metadata: metadataPromise };
  }
}

export function createProvider(
  provider: Provider,
  apiKey: string,
): LLMProvider {
  switch (provider) {
    case "google":
      return new GeminiProvider(apiKey);
    case "openai":
      return new OpenAIProvider(apiKey);
    case "anthropic":
      return new AnthropicProvider(apiKey);
    case "openrouter":
      return new OpenRouterProvider(apiKey);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export function getProvider(): {
  provider: LLMProvider;
  name: Provider;
  model: string;
} {
  const name = DEFAULT_PROVIDER;
  const model = OPENROUTER_MODEL;
  const apiKey = OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[SDK] Environment debug:");
    console.error("  DEFAULT_PROVIDER:", name);
    console.error("  OPENROUTER_API_KEY exists:", !!OPENROUTER_API_KEY);
    throw new Error(
      `API key not configured for provider: ${name}. Set OPENROUTER_API_KEY in .env file.`,
    );
  }

  return { provider: createProvider(name, apiKey), name, model };
}

export function getAvailableProviders(): {
  name: Provider;
  model: string;
  available: boolean;
}[] {
  const providers: Provider[] = ["google", "openai", "anthropic", "openrouter"];
  return providers.map((name) => ({
    name,
    model: getDefaultModel(name),
    available: !!getApiKey(name),
  }));
}

// Async log dispatcher - fire and forget
export function dispatchLog(
  sessionId: string,
  messageId: string | undefined,
  metadata: InferenceMetadata,
): void {
  const event: LogEvent = {
    type: "inference_log",
    payload: { ...metadata, sessionId, messageId },
  };

  logQueue.push(event);

  // Process queue asynchronously
  if (!logProcessor) {
    logProcessor = processLogQueue();
  }
}

async function processLogQueue(): Promise<void> {
  // Wait a tick to batch multiple logs
  await new Promise((resolve) => setTimeout(resolve, 100));

  while (logQueue.length > 0) {
    const event = logQueue.shift()!;
    try {
      await sendToIngestion(event.payload);
    } catch {
      // Retry once after delay
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sendToIngestion(event.payload);
      } catch {
        // Log to console in production, swallow in silence
        console.error("[SDK] Failed to dispatch log:", event.payload);
      }
    }
  }

  logProcessor = null;
}

async function sendToIngestion(payload: LogEvent["payload"]): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  await fetch(`${baseUrl}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      provider: payload.provider,
      model: payload.model,
      latencyMs: payload.latencyMs,
      promptTokens: payload.promptTokens,
      completionTokens: payload.completionTokens,
      totalTokens: payload.totalTokens,
      throughputTokensPerSec: payload.throughputTokensPerSec,
      statusCode: payload.statusCode,
      errorMessage: payload.errorMessage,
      inputPreview: payload.inputPreview,
      outputPreview: payload.outputPreview,
      timestamp: new Date().toISOString(),
    }),
    // Fire and forget - don't wait for response in streaming context
    keepalive: true,
  });
}

function getDefaultModel(provider: Provider): string {
  switch (provider) {
    case "google":
      return "gemini-2.0-flash";
    case "openai":
      return "gpt-4.1";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "openrouter":
      return "openai/gpt-3.5-turbo";
    default:
      return "openai/gpt-3.5-turbo";
  }
}

function getApiKey(provider: Provider): string | undefined {
  switch (provider) {
    case "google":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openrouter":
      return OPENROUTER_API_KEY;
  }
}

export { truncate } from "./pii";
