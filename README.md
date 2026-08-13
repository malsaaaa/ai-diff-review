# AI Diff Review Service

An asynchronous HTTP service that parses unified diffs and detects code quality and security findings through deterministic rules (mock provider) or structured generative AI (LLM provider). It includes a premium Web Dashboard and Developer Playground.

![Dashboard Playground Preview](public/dashboard-live.png)

## 🚀 Live Demo & Playground

The service is fully deployed and accessible live in the cloud:
*   **Web Dashboard URL**: [https://ai-diff-review-c8pe.onrender.com](https://ai-diff-review-c8pe.onrender.com)
*   **Default Bearer Token**: `default-super-secret-token`

*You can open the Web Dashboard URL in your browser to test diffs and monitor live events.*

---

## Features
- **Deterministic Rules (Mock)**: Scans added lines in diffs for eval, loose nulls, console logs, hardcoded credentials, SQL concatenation, swallowed catch blocks, TODO markers, and prompt injection content.
- **AI Review (LLM)**: Leverages Google Gemini API (`gemini-3.5-flash`) with schema enforcement to scan code and return structured JSON findings.
- **Interactive Playground**: Web-based frontend directly served at `GET /` to paste diffs, configure runs, and watch findings stream in real-time.
- **Idempotency**: Prevents duplicate executions when using `Idempotency-Key` headers.
- **Caching**: Instantly resolves previously completed reviews of byte-identical payloads with `cacheHit: true`.
- **Chunking**: Splits large diffs (>64 KiB) at file boundaries to satisfy payload constraints without losing context.
- **Streaming (SSE)**: Streams status updates and findings in real-time. Supports full replay for completed jobs.
- **Rate Limiting**: Throttles submission bursts beyond 30 requests/minute.

---

## How to Generate and Submit Diffs

### 1. Generating a Git Diff locally
To test files, developers generate unified diffs using standard git commands in their terminals:

*   **Changes currently in progress (unstaged)**:
    ```bash
    git diff
    ```
*   **Changes that have been staged (`git add .`)**:
    ```bash
    git diff --cached
    ```
*   **Changes compared to the main branch**:
    ```bash
    git diff main
    ```
*   **Save the diff to a file to copy it**:
    ```bash
    git diff > changes.diff
    ```
*Copy the printed output (including the header lines) and paste it into the Web Dashboard.*

### 2. Submitting via API (cURL)
You can submit reviews programmatically. Make a POST request with the diff payload:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer default-super-secret-token" \
  -d '{
    "diff": "diff --git a/src/db.ts b/src/db.ts\n+++ b/src/db.ts\n@@ -1,2 +1,3 @@\n+const x = 1;\n+eval(x);",
    "options": {
      "provider": "mock",
      "maxFindings": 100
    }
  }' \
  https://ai-diff-review-c8pe.onrender.com/v1/reviews
```

---

## Prerequisites
- Node.js v20+
- npm v10+

## Setup & Local Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables. Create a `.env` file in the project root:
   ```env
   PORT=3000
   AUTH_BEARER_TOKEN=default-super-secret-token
   GEMINI_API_KEY=your-google-gemini-api-key
   ```
   *If `GEMINI_API_KEY` is not configured, calling the `llm` provider will fail gracefully with a clear error payload.*

## Running the Service Locally

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
- `GET /` -> Serves the interactive Web Dashboard.
- `GET /health` -> Returns service status, version, and uptime.
- `GET /spec` -> Returns machine-readable capability spec.

### Protected Routes (Requires `Authorization: Bearer <token>`)
- `POST /v1/reviews` -> Submits a unified diff for asynchronous review.
- `GET /v1/reviews/:jobId` -> Retrieves review progress, findings, and usage data.
- `GET /v1/reviews/:jobId/stream` -> real-time Server-Sent Events stream of status and findings.
