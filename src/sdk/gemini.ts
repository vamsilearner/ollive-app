/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  GoogleGenerativeAI,
  ChatSession,
  GenerateContentResult,
} from "@google/generative-ai";
import { LLMProvider, ChatOptions } from "./provider";
import { InferenceMetadata, Message } from "@/types";

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemini-2.0-flash";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async chat(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<{ content: string; metadata: InferenceMetadata }> {
    const model = this.client.getGenerativeModel({
      model: options?.model || DEFAULT_MODEL,
    });
    const systemMessage = messages.find((m) => m.role === "system");

    const chatMessages = messages.filter((m) => m.role !== "system");
    const userMessage = chatMessages[chatMessages.length - 1]?.content || "";
    const rawHistory = chatMessages.slice(0, -1);

    const chat: ChatSession = model.startChat({
      history: this.formatHistory(rawHistory),
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      },
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
    });

    const startTime = performance.now();

    try {
      if (!userMessage.trim()) {
        throw new Error("Prompt text content cannot be blank.");
      }

      const result: GenerateContentResult = await chat.sendMessage(userMessage);
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const text = result.response.text();
      const usage = result.response.usageMetadata;

      const metadata: InferenceMetadata = {
        provider: "google",
        model: options?.model || DEFAULT_MODEL,
        latencyMs,
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
        throughputTokensPerSec: usage?.candidatesTokenCount
          ? Math.round((usage.candidatesTokenCount / latencyMs) * 1000 * 100) /
            100
          : 0,
        statusCode: "SUCCESS",
        inputPreview: userMessage,
        outputPreview: text,
      };

      return { content: text, metadata };
    } catch (error) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      throw this.buildError(
        error,
        latencyMs,
        userMessage,
        options?.model || DEFAULT_MODEL,
      );
    }
  }

  async chatStream(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<{
    stream: ReadableStream<string>;
    metadata: Promise<InferenceMetadata>;
  }> {
    const model = this.client.getGenerativeModel({
      model: options?.model || DEFAULT_MODEL,
    });
    const systemMessage = messages.find((m) => m.role === "system");

    const chatMessages = messages.filter((m) => m.role !== "system");
    const userMessage = chatMessages[chatMessages.length - 1]?.content || "";
    const rawHistory = chatMessages.slice(0, -1);

    // Enforce robust alternating history validation arrays
    const formattedHistory = this.formatHistory(rawHistory);

    const chat: ChatSession = model.startChat({
      history: formattedHistory,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      },
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
    });

    const startTime = performance.now();
    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // Local explicit scope hooks to resolve promises without global state pollution
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
           if (!userMessage.trim()) {
             throw new Error("Prompt text content cannot be blank.");
           }

           const result = await chat.sendMessageStream(userMessage, {
             signal: options?.signal,
           });

           for await (const chunk of result.stream) {
             const text = chunk.text();
             if (text) {
               fullText += text;
               controller.enqueue(text);
             }

             if (chunk.usageMetadata) {
               promptTokens =
                 chunk.usageMetadata.promptTokenCount ?? promptTokens;
               completionTokens =
                 chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
             }
           }

           const endTime = performance.now();
           const latencyMs = Math.round(endTime - startTime);

           const metadata: InferenceMetadata = {
             provider: "google",
             model: options?.model || DEFAULT_MODEL,
             latencyMs,
             promptTokens,
             completionTokens,
             totalTokens: promptTokens + completionTokens,
             throughputTokensPerSec: completionTokens
               ? Math.round((completionTokens / latencyMs) * 1000 * 100) / 100
               : 0,
             statusCode: "SUCCESS",
             inputPreview: userMessage,
             outputPreview: fullText,
           };

           resolveMetadata(metadata);
           controller.close();
         } catch (error) {
           const err = error instanceof Error ? error : new Error(String(error));
           console.error("Gemini SDK internal execution failure:", err.message);
           const endTime = performance.now();
           const latencyMs = Math.round(endTime - startTime);

           if (err.name === "AbortError") {
             const metadata: InferenceMetadata = {
               provider: "google",
               model: options?.model || DEFAULT_MODEL,
               latencyMs,
               promptTokens: 0,
               completionTokens: 0,
               totalTokens: 0,
               throughputTokensPerSec: 0,
               statusCode: "SUCCESS",
               inputPreview: userMessage,
               outputPreview: fullText,
             };
             resolveMetadata(metadata);
           } else {
             rejectMetadata(err);
           }
           controller.enqueue(`\nError: ${err.message}`);
           controller.close();
         }
       },
     });

    return { stream, metadata: metadataPromise };
  }

  /**
   * Sanitizes conversation logs into a clean, alternating structure
   * to strictly satisfy Gemini's API history architecture.
   */
  private formatHistory(
    messages: Message[],
  ): Array<{ role: "user" | "model"; parts: [{ text: string }] }> {
    const result: Array<{ role: "user" | "model"; parts: [{ text: string }] }> =
      [];

    // 1. Map client layers to raw API roles, filtering out empty entries
    const historicalEntries = messages
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") && m.content?.trim(),
      )
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        text: m.content.trim(),
      }));

    // 2. Squash sequential matching roles together to uphold strict sequence alternation
    for (const entry of historicalEntries) {
      const entryRole = entry.role;
      if (result.length > 0 && result[result.length - 1].role === entryRole) {
        // Line-break combine continuous posts under a single role wrapper block
        result[result.length - 1].parts[0].text += `\n${entry.text}`;
      } else {
        result.push({
          role: entryRole,
          parts: [{ text: entry.text }],
        });
      }
    }

    return result;
  }

  private buildError(
    error: unknown,
    latencyMs: number,
    input: string,
    model: string,
  ): never {
    const message = error instanceof Error ? error.message : "Unknown error";
    const metadata: InferenceMetadata = {
      provider: "google",
      model,
      latencyMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      throughputTokensPerSec: 0,
      statusCode: "ERROR",
      errorMessage: message,
      inputPreview: input,
      outputPreview: "",
    };
    const err = new Error(message) as Error & { metadata?: InferenceMetadata };
    err.metadata = metadata;
    throw err;
  }
}
