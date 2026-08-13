# AI Diff Review Service

An asynchronous HTTP service that parses unified diffs and detects code findings through deterministic rules (mock provider) or structured generative AI (LLM provider).

## Features
- **Deterministic Rules (Mock)**: Scans added lines in diffs for eval, loose nulls, console logs, hardcoded credentials, SQL concatenation, swallowed catch blocks, TODO markers, and prompt injection content.
- **AI Review (LLM)**: Leverages Google Gemini API with schema enforcement to scan code and return structured JSON findings.
- **Idempotency**: Prevents duplicate executions when using `Idempotency-Key` headers.
- **Caching**: Instantly resolves previously completed reviews of byte-identical payloads with `cacheHit: true`.
- **Chunking**: Splits large diffs (>64 KiB) at file boundaries to satisfy payload constraints without losing context.
- **Streaming (SSE)**: Streams status updates and findings in real-time. Supports full replay for completed jobs.
- **Rate Limiting**: Throttles submission bursts beyond 30 requests/minute.

## Prerequisites
- Node.js v20+
- npm v10+

## Setup & Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Configure environment variables. Create a `.env` file in the project root:
   ```env
   PORT=3000
   AUTH_BEARER_TOKEN=your-custom-bearer-token
   GEMINI_API_KEY=your-google-gemini-api-key
   ```
   *If `AUTH_BEARER_TOKEN` is not specified, it defaults to `default-super-secret-token`.*
   *If `GEMINI_API_KEY` is not specified, calling the `llm` provider will fail gracefully with a clear error payload.*

## Running the Service

- **Development Mode (watch)**:
  ```bash
  npm run dev
  ```
- **Production Build**:
  ```bash
  npm run build
  npm start
  ```

## Running the Integration Tests
The integration test suite validates all API specifications, including authentication, rate-limiting, error handling, caching, idempotency, chunking, and SSE event streaming/replay.

Run the test suite:
```bash
npx tsx src/test/integration.ts
```

## API Endpoint Reference

### Public Routes
- `GET /health` -> Returns service status, version, and uptime.
- `GET /spec` -> Returns machine-readable capability spec.

### Protected Routes (Requires `Authorization: Bearer <token>`)
- `POST /v1/reviews` -> Submits a unified diff for asynchronous review.
- `GET /v1/reviews/:jobId` -> Retrieves review progress, findings, and usage data.
- `GET /v1/reviews/:jobId/stream` -> real-time Server-Sent Events stream of status and findings.
