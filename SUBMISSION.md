# Submission: AI Diff Review Service

## Service Information
- **Base URL**: `https://ai-diff-review-c8pe.onrender.com`
- **Bearer Token**: `default-super-secret-token`
- **Repository URL**: `https://github.com/malsaaaa/ai-diff-review`

## Architecture
The service is built on Node.js and TypeScript, utilizing Express for the HTTP layer. State (jobs, findings, idempotency keys, and caches) is kept in an in-memory data store that automatically persists as JSON to `data-store.json` using debounced background writes.
Asynchronous job scheduling is managed by a custom FIFO execution queue which limits concurrency to at most 4 active jobs, gracefully queueing further tasks. 

## Provider Design
1. **Mock Provider**: A deterministic, comment-aware rules engine parsing hunk headers to reconstruct target files. It evaluates the exact regex patterns (using lookarounds to prevent false positives on strict comparisons) and runs comment-stripping to reliably detect multi-line empty catch blocks and ignore triggers in comments.
2. **LLM Provider**: Uses raw HTTP fetches to interact with the Google Gemini API (model `gemini-3.5-flash`), enforcing structured JSON output schema matching the `Finding` type. It fails gracefully with clear error statuses if credentials are missing or the API is unreachable.

## Verification of Cross-Cutting Behaviors
We verified all major requirements using an automated integration test suite in `src/test/integration.ts`:
- **Auth & Spec**: Verified that `/spec` and `/health` are public, and all `/v1/*` routes block missing or wrong tokens with a `401` status.
- **Idempotency**: Checked that duplicate keys with identical bodies yield the same `jobId`, while mismatched bodies yield a `409` conflict.
- **Caching**: Confirmed that byte-identical diffs/options avoid reprocessing, returning a completed state instantly with `"cacheHit": true`.
- **Chunking**: Generated a 300+ KiB diff split across 10 files. Verified that it parses into exactly 5 chunks of ≤64 KiB split cleanly on file boundaries.
- **SSE Streaming & Replay**: Validated that connecting to active streams yields sequential events (`status`, `finding`, `done`), and connecting to finished streams replays the identical event sequence before closing.

## AI Tools & Design Decisions
- **AI Tools Used**: Gemini 3.5 Flash via Antigravity.
- **Rejected AI Suggestion & Why**: The AI initially suggested installing `better-sqlite3` or `sqlite3` for persistence. I rejected this because compile-time binary dependencies frequently fail or have compatibility issues on Windows dev systems. A lightweight, atomic, file-backed JSON store provides the same stability and persistence guarantees with zero native compilation risks and absolute cross-platform reliability.
- **Next Steps (With More Time)**:
  - Add request tracing/correlation IDs for debugging across async loops.
  - Implement a persistent database like PostgreSQL or Redis for distributed scale.
  - Set up horizontal auto-scaling and separate worker threads/microservices for CPU-bound mock scanning and network-bound LLM processing.
