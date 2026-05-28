import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Conversation'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessionsRelations = relations(sessions, ({ many }) => ({
  messages: many(messages),
  inferenceLogs: many(inferenceLogs),
}));

// Messages
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
}));

// Inference Logs
export const inferenceLogs = sqliteTable('inference_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  throughputTokensPerSec: text('throughput_tokens_per_sec').notNull().default('0'),
  statusCode: text('status_code').notNull(),
  errorMessage: text('error_message'),
  inputPreview: text('input_preview'),
  outputPreview: text('output_preview'),
  timestamp: text('timestamp').notNull(),
});

export const inferenceLogsRelations = relations(inferenceLogs, ({ one }) => ({
  session: one(sessions, {
    fields: [inferenceLogs.sessionId],
    references: [sessions.id],
  }),
  message: one(messages, {
    fields: [inferenceLogs.messageId],
    references: [messages.id],
  }),
}));
