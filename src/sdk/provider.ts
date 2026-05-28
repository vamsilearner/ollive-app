import { InferenceMetadata, Message } from '@/types';

// Provider abstraction interface
export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<{ content: string; metadata: InferenceMetadata }>;
  chatStream(messages: Message[], options?: ChatOptions): Promise<{ stream: ReadableStream<string>; metadata: Promise<InferenceMetadata> }>;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type { InferenceMetadata, Message };
