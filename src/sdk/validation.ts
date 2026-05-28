import { z } from 'zod';

// Validation schemas for ingestion pipeline
export const logPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  provider: z.string().max(100),
  model: z.string().max(100),
  latencyMs: z.number().int().positive(),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  throughputTokensPerSec: z.number().nonnegative().default(0),
  statusCode: z.enum(['SUCCESS', 'ERROR']),
  errorMessage: z.string().nullable().optional(),
  inputPreview: z.string().max(5000).optional().default(''),
  outputPreview: z.string().max(5000).optional().default(''),
  timestamp: z.coerce.date(),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  sessionId: z.string().uuid().nullable().optional(),
  provider: z.enum(['google', 'openai', 'anthropic', 'openrouter']).optional(),
  model: z.string().max(100).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional().default([]),
});

export type LogPayloadInput = z.infer<typeof logPayloadSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
