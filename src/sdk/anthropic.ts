import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, ChatOptions } from './provider';
import { InferenceMetadata, Message } from '@/types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<{ content: string; metadata: InferenceMetadata }> {
    const startTime = performance.now();
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    try {
      const response = await this.client.messages.create({
        model: options?.model || DEFAULT_MODEL,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemMessage?.content,
        messages: chatMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant' as const,
          content: m.content,
        })),
      });

      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as Anthropic.TextBlock).text)
        .join('');

      const metadata: InferenceMetadata = {
        provider: 'anthropic',
        model: options?.model || DEFAULT_MODEL,
        latencyMs,
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
        totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
        throughputTokensPerSec: response.usage?.output_tokens
          ? Math.round((response.usage.output_tokens / latencyMs) * 1000 * 100) / 100
          : 0,
        statusCode: 'SUCCESS',
        inputPreview: chatMessages[chatMessages.length - 1]?.content || '',
        outputPreview: content,
      };

      return { content, metadata };
    } catch (error) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      throw this.buildError(error, latencyMs, chatMessages, options?.model || DEFAULT_MODEL);
    }
  }

  async chatStream(messages: Message[], options?: ChatOptions): Promise<{ stream: ReadableStream<string>; metadata: Promise<InferenceMetadata> }> {
    const startTime = performance.now();
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        try {
          const response = await this.client.messages.stream({
            model: options?.model || DEFAULT_MODEL,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature ?? 0.7,
            system: systemMessage?.content,
            messages: chatMessages.map(m => ({
              role: m.role === 'user' ? 'user' : 'assistant' as const,
              content: m.content,
            })),
          }, { signal: options?.signal });

          for await (const event of response) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullText += event.delta.text;
              controller.enqueue(event.delta.text);
            }
          }

          const message = await response.finalMessage();
          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          inputTokens = message.usage?.input_tokens ?? 0;
          outputTokens = message.usage?.output_tokens ?? 0;

          const metadata: InferenceMetadata = {
            provider: 'anthropic',
            model: options?.model || DEFAULT_MODEL,
            latencyMs,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            throughputTokensPerSec: outputTokens
              ? Math.round((outputTokens / latencyMs) * 1000 * 100) / 100
              : 0,
            statusCode: 'SUCCESS',
            inputPreview: chatMessages[chatMessages.length - 1]?.content || '',
            outputPreview: fullText,
          };

          controller.close();
          (globalThis as any).__anthropic_metadata_resolve?.(metadata);
        } catch (error) {
          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);

          if (error instanceof Error && error.name === 'AbortError') {
            const metadata: InferenceMetadata = {
              provider: 'anthropic',
              model: options?.model || DEFAULT_MODEL,
              latencyMs,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens: inputTokens + outputTokens,
              throughputTokensPerSec: 0,
              statusCode: 'SUCCESS',
              inputPreview: chatMessages[chatMessages.length - 1]?.content || '',
              outputPreview: fullText,
            };
            (globalThis as any).__anthropic_metadata_resolve?.(metadata);
            controller.close();
            return;
          }

          (globalThis as any).__anthropic_metadata_reject?.(error);
          controller.error(error);
        }
      },
    });

    const metadata = new Promise<InferenceMetadata>((resolve, reject) => {
      (globalThis as any).__anthropic_metadata_resolve = resolve;
      (globalThis as any).__anthropic_metadata_reject = reject;
    });

    return { stream, metadata };
  }

  private buildError(error: unknown, latencyMs: number, messages: Message[], model: string): never {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const metadata: InferenceMetadata = {
      provider: 'anthropic',
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
