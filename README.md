# Ollive - LLM Inference Logging & Ingestion System

A production-ready LLM chatbot with real-time inference logging, ingestion pipeline, PostgreSQL storage, streaming responses, analytics dashboard, and one-command Docker setup.

## Quick Start

```bash
# 1. Clone and setup
cp .env.example .env
# Edit .env and add your LLM API keys (at least one required)

# 2. One-command start
docker compose up -d

# 3. Run migrations
docker compose exec app npx drizzle-kit generate
docker compose exec app npx drizzle-kit migrate

# 4. Open
# Chat: http://localhost:3000/chat
# Dashboard: http://localhost:3000/dashboard
# DB Admin: http://localhost:8080
```

## Local Development

```bash
# Start PostgreSQL
docker compose up -d postgres

# Install and run
npm install
npx drizzle-kit generate
npx drizzle-kit migrate
npm run dev
```

## Architecture Overview

```
+-------------+                       +-------------------+
|  Chat UI    | <--- (Streams text) - |  Next.js API      |
|  (Next.js)  | --------------------> |  /api/chat        |
+-------------+                       +-------------------+
                                                |
                                      (Async Ingest Payload)
                                                v
+-------------+                       +-------------------+
| PostgreSQL  | <-------------------- | Ingestion API     |
|  Database   |                       |  /api/logs        |
+-------------+                       +-------------------+
```

### Key Design Decisions

1. **Monorepo Architecture**: Frontend, API routes, SDK, and ingestion pipeline all in one Next.js app. Simplifies deployment and keeps the critical path tight.

2. **Async Log Dispatch**: The inference SDK captures metadata (latency, tokens, timestamps) and fires logs asynchronously to `/api/logs` without blocking the streaming response. If ingestion fails, the chat still works.

3. **Multi-Provider Abstraction**: A unified `LLMProvider` interface wraps Gemini, OpenAI, and Anthropic. Switch providers via env config or runtime selection.

4. **Drizzle ORM over Prisma**: Lightweight, SQL-transparent, type-safe. Better for understanding schema decisions and interview discussions.

5. **Streaming via ReadableStream**: Native Web API streaming through Next.js API routes. No SSE or WebSocket complexity for this scope.

## Schema Design

### sessions
Tracks user chat sessions with lifecycle status.
- `id` (UUID PK), `title`, `status` (active/cancelled/completed), `created_at`, `updated_at`

### messages
Stores individual conversation turns, linked to sessions.
- `id` (UUID PK), `session_id` (FK cascade), `role` (user/assistant/system), `content`, `created_at`

### inference_logs
Deep technical metrics for every LLM call, tied to assistant messages.
- `id` (UUID PK), `session_id` (FK cascade), `message_id` (FK set null)
- `provider`, `model`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `throughput_tokens_per_sec`
- `status_code` (SUCCESS/ERROR), `error_message`, `input_preview`, `output_preview` (PII-redacted), `timestamp`

### Why Relational?
PostgreSQL enforces that inference logs cannot exist without valid session context. This preserves dashboard data integrity and enables efficient aggregation queries.

## Trade-offs

| Decision | Choice | Why | Production Alternative |
|----------|--------|-----|----------------------|
| Architecture | Monorepo (Next.js API routes) | Interview scope, simpler deployment | Separate ingestion service |
| Ingestion | Direct DB write | Minimal infrastructure | Kafka/RabbitMQ for write spikes |
| ORM | Drizzle | SQL-transparent, lightweight | Prisma or raw SQL |
| Streaming | ReadableStream | Web standard, no extra deps | SSE for long-lived connections |
| PII Redaction | Regex patterns | Pragmatic, covers common cases | NLP-based PII detection |
| Retry | Exponential backoff + queue | Simple, handles transient failures | Persistent message queue |

## Scaling Considerations

1. **Ingestion at Scale**: Add a message broker (Kafka/RabbitMQ) between the ingestion API and database. The SDK already batches and retries, so the broker integration point is clear.

2. **Read Heavy Dashboard**: Add materialized views or a read replica for dashboard queries. The aggregation SQL is already optimized with time-bucket grouping.

3. **Multi-Region**: The SDK's async dispatch can target regional ingestion endpoints. Session data can be replicated via PostgreSQL logical replication.

4. **Rate Limiting**: Add per-session and per-user rate limits at the API route level. The session model supports this naturally.

## Failure Handling

- **Ingestion Down**: Chat continues working. Logs queue in memory and retry with backoff. Failed logs are logged to console.
- **LLM Provider Down**: Error is caught, metadata is still logged with `status_code=ERROR`, user sees error message.
- **Database Down**: Ingestion returns 500, SDK retries. Chat response is unaffected (already streamed).
- **Stream Cancelled**: AbortController cleanly stops the LLM request. Partial content and metadata are still saved.

## Bonus Features Completed

| Feature | Status | Implementation |
|---------|--------|---------------|
| Multi-provider support | Done | Gemini, OpenAI, Anthropic with unified interface |
| Streaming responses | Done | ReadableStream with chunk-by-chunk UI updates |
| Latency/Throughput/Error dashboard | Done | Recharts with live PostgreSQL aggregation |
| Docker Compose setup | Done | One-command `docker compose up` |
| Event-based architecture | Done | Async log queue with batching and retry |
| PII redaction | Done | Regex-based redaction before logging |
| Cancel conversations | Done | AbortController integration |
| List/resume sessions | Done | Session sidebar with full history restore |

## Kubernetes Deployment

Basic K8s manifests are available in `k8s/`:
- `deployment.yaml` - Next.js app deployment
- `service.yaml` - ClusterIP service
- `configmap.yaml` - Environment configuration
- `postgres-statefulset.yaml` - PostgreSQL StatefulSet with PVC

## What I'd Improve With More Time

1. **Message Queue**: Replace the in-memory log queue with Redis Streams or a proper message broker
2. **User Auth**: Add authentication with session-based or JWT auth
3. **Real-time Dashboard**: WebSocket or SSE for live metric updates
4. **Better PII**: ML-based PII detection instead of regex patterns
5. **Cost Tracking**: Track token costs per provider and display in dashboard
6. **A/B Testing**: Route traffic between providers and compare latency/quality
7. **Prompt Templates**: Saved prompt templates with versioning
8. **Export**: CSV/JSON export of inference logs and session data

## Tech Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript + TailwindCSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL 16
- **ORM**: Drizzle ORM
- **LLM SDK**: Custom multi-provider wrapper (Gemini + OpenAI + Anthropic)
- **Charts**: Recharts
- **Markdown**: react-markdown + remark-gfm
- **Containerization**: Docker + Docker Compose

## Architecture Notes
Detailed architecture notes, including ingestion flow, logging strategy, scaling considerations, and failure handling assumptions, are available in [ARCHITECTURE_NOTES.md](./ARCHITECTURE_NOTES.md).

## Demo
To run a local demo, follow the [Quick Start](#quick-start) steps above. The application will be available at:
- Chat: http://localhost:3000/chat
- Dashboard: http://localhost:3000/dashboard
- Database Admin (phpMyAdmin): http://localhost:8080

Alternatively, we can deploy to a cloud provider (e.g., Vercel for frontend, Render for backend) but that is beyond the scope of this README.