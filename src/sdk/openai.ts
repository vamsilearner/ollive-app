import OpenAI from 'openai';
import { LLMProvider, ChatOptions } from './provider';
import { InferenceMetadata, Message } from '@/types';

const DEFAULT_MODEL = 'gpt-4.1';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<{ content: string; metadata: InferenceMetadata }> {
    const startTime = performance.now();

    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || DEFAULT_MODEL,
        messages: messages.map(m => ({ role: m.role, content: m.content })) as OpenAI.ChatCompletionMessageParam[],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stream: false,
      });

      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';
      const usage = response.usage;

      const metadata: InferenceMetadata = {
        provider: 'openai',
        model: options?.model || DEFAULT_MODEL,
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        throughputTokensPerSec: usage?.completion_tokens
          ? Math.round((usage.completion_tokens / latencyMs) * 1000 * 100) / 100
          : 0,
        statusCode: 'SUCCESS',
        inputPreview: messages[messages.length - 1]?.content || '',
        outputPreview: content,
      };

      return { content, metadata };
    } catch (error) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      throw this.buildError(error, latencyMs, messages, options?.model || DEFAULT_MODEL);
    }
  }

  async chatStream(messages: Message[], options?: ChatOptions): Promise<{ stream: ReadableStream<string>; metadata: Promise<InferenceMetadata> }> {
    const startTime = performance.now();
    let fullText = '';
    let promptTokens = 0;
    let completionTokens = 0;

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        try {
          const response = await this.client.chat.completions.create({
            model: options?.model || DEFAULT_MODEL,
            messages: messages.map(m => ({ role: m.role, content: m.content })) as OpenAI.ChatCompletionMessageParam[],
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            stream: true,
          });

          for await (const chunk of response) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              controller.enqueue(delta);
            }
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
              completionTokens = chunk.usage.completion_tokens ?? completionTokens;
            }
          }

          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          const metadata: InferenceMetadata = {
            provider: 'openai',
            model: options?.model || DEFAULT_MODEL,
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            throughputTokensPerSec: completionTokens
              ? Math.round((completionTokens / latencyMs) * 1000 * 100) / 100
              : 0,
            statusCode: 'SUCCESS',
            inputPreview: messages[messages.length - 1]?.content || '',
            outputPreview: fullText,
          };

          controller.close();
          // Resolve metadata via a side channel
          (globalThis as any).__openai_metadata_resolve?.(metadata);
        } catch (error) {
          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          if (error instanceof Error && error.name === 'AbortError') {
            const metadata: InferenceMetadata = {
              provider: 'openai',
              model: options?.model || DEFAULT_MODEL,
              latencyMs,
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              throughputTokensPerSec: 0,
              statusCode: 'SUCCESS',
              inputPreview: messages[messages.length - 1]?.content || '',
              outputPreview: fullText,
            };
            (globalThis as any).__openai_metadata_resolve?.(metadata);
            controller.close();
            return;
          }

          (globalThis as any).__openai_metadata_reject?.(error);
          controller.error(error);
        }
      },
    });

    const metadata = new Promise<InferenceMetadata>((resolve, reject) => {
      (globalThis as any).__openai_metadata_resolve = resolve;
      (globalThis as any).__openai_metadata_reject = reject;
    });

    return { stream, metadata };
  }

  private buildError(error: unknown, latencyMs: number, messages: Message[], model: string): never {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const metadata: InferenceMetadata = {
      provider: 'openai',
      model,
      latencyMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      throughputTokensPerSec: 0,
      statusCode: 'ERROR',
      errorMessage: message,
      inputPreview: messages[messages.length - 1]?.content || '',
      outputPreview: '',
    };
    const err = new Error(message) as Error & { metadata?: InferenceMetadata };
    err.metadata = metadata;
    throw err;
  }
}
