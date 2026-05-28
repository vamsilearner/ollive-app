// Shared types for the LLM Inference Logging System

export type Provider = 'google' | 'openai' | 'anthropic' | 'openrouter';

export type MessageRole = 'user' | 'assistant' | 'system';

export type SessionStatus = 'active' | 'cancelled' | 'completed';

export interface Message {
  id?: string;
  sessionId?: string;
  role: MessageRole;
  content: string;
  createdAt?: Date;
}

export interface InferenceMetadata {
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  throughputTokensPerSec: number;
  statusCode: 'SUCCESS' | 'ERROR';
  errorMessage?: string;
  inputPreview: string;
  outputPreview: string;
}

export interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  provider?: Provider;
  model?: string;
  history: Message[];
}

export interface ChatStreamResponse {
  stream: ReadableStream<Uint8Array>;
  metadata: InferenceMetadata;
  assistantMessageId?: string;
}

export interface LogPayload {
  sessionId: string;
  messageId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  throughputTokensPerSec: number;
  statusCode: 'SUCCESS' | 'ERROR';
  errorMessage?: string;
  inputPreview: string;
  outputPreview: string;
  timestamp: Date;
}

export interface DashboardMetrics {
  latencyOverTime: { timestamp: Date; avgLatencyMs: number }[];
  throughputOverTime: { timestamp: Date; avgThroughput: number }[];
  errorRateOverTime: { timestamp: Date; errorRate: number; totalRequests: number }[];
}
