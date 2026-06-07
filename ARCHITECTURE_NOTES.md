# Architecture Notes

## Ingestion Flow

1. The chatbot UI sends a message to the Next.js API route `/api/chat`.
2. The API route invokes the LLM SDK wrapper (multi-provider) which:
   - Records start timestamp
   - Calls the selected LLM provider (Gemini/OpenAI/Anthropic/OpenRouter) with streaming
   - Captures streaming chunks to build the response
   - On completion/error, records latency, token usage, and status
   - Constructs a log payload with metadata (model, provider, timestamps, session ID, input/output previews, etc.)
   - Asynchronously dispatches the log payload to `/api/logs` via `fetch` with `keepalive:true` (non-blocking)
3. The `/api/logs` API route:
   - Validates and parses the incoming JSON payload
   - Extracts and sanitizes fields (PII redaction applied to previews)
   - Uses Drizzle ORM to insert into `inference_logs` table
   - Returns 202 Accepted on success, 400 on validation error, 500 on DB error
4. The SDK implements retry logic with exponential backoff for failed log transmissions.

## Logging Strategy

- **What is logged**: Every LLM inference call generates a log entry with:
   - Core identifiers: session_id, message_id (foreign key to messages)
   - Provider/model details: provider name, model name
   - Performance: latency_ms, token counts (prompt/completion/total), throughput
   - Outcome: status_code (SUCCESS/ERROR), error_message if applicable
   - Data samples: truncated input_preview and output_preview (PII-redacted)
   - Timestamps: request start/end times
- **PII Redaction**: Uses regex patterns to redact emails, phone numbers, SSNs, and credit card numbers from previews before logging.
- **Async Dispatch**: Logging is fire-and-forget relative to the chat response to avoid impacting user experience. Failed logs are retried with backoff.
- **Data Verbosity**: Stores full message content in `messages` table for conversation reconstruction, while `inference_logs` focuses on technical metrics.

## Scaling Considerations

1. **Ingestion Throughput**:
   - Current: Direct writes to SQLite via API route
   - Scale path: Introduce a message buffer (Redis Streams or Apache Kafka) between SDK and ingestion API to absorb write spikes
   - The SDK's batching/retry mechanism would adapt to send to the buffer instead
2. **Read Scaling**:
   - Dashboard queries aggregate from `inference_logs` with time-bucket grouping
   - For heavy read loads: add read replicas or materialized views for pre-aggregated metrics
3. **Horizontal Scaling**:
   - Next.js app is stateless except for WebSocket connections (not used here)
   - Can scale API routes via container orchestration (Kubernetes) with load balancing
   - SQLite would require scaling vertically (since it's file-based) or consider migrating to PostgreSQL for horizontal scaling
4. **Session Storage**:
   - Currently stored in SQLite; no scaling limits expected for MVP
   - For massive scale: consider separating session metadata to a faster store (Redis) and migrating to PostgreSQL as the source of truth

## Failure Handling Assumptions

- **Ingestion Failure**:
   - Assumed transient; SDK retries with exponential backoff (3 attempts)
   - After final failure, logs are dropped but chat continues unaffected
   - Failed logs are console-warned for operator awareness
- **LLM Provider Failure**:
   - Errors are caught, logged with status_code=ERROR, and user sees error message
   - Chat UI displays error and allows retry or new conversation
- **Database Failure**:
   - Ingestion API returns 500; SDK treats as transient failure and retries
   - Streamed chat response is already delivered to user (non-blocking design)
- **Network Partitions**:
   - SDK uses `navigator.onLine` to detect offline state and queues logs
   - On reconnection, queued logs are flushed with retry logic
- **Resource Exhaustion**:
   - No specific circuit breaker; relies on platform limits (e.g., Heroku/Node.js memory limits)
   - Log payloads are small (<2KB) so memory impact is minimal
- **Data Consistency**:
   - Foreign key constraints ensure logs reference valid sessions/messages
   - On deletion of a session, associated messages and logs are cascade-deleted
