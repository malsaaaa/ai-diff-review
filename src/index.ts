import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { store } from './store.js';
import { queue } from './queue.js';
import { isValidUnifiedDiff } from './diff-parser.js';
import { ReviewOptions, Job } from './types.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BEARER_TOKEN = process.env.AUTH_BEARER_TOKEN || 'default-super-secret-token';

// Spec Declaration
const SPEC = {
  specVersion: '1.0',
  providers: ['mock', 'llm'],
  limits: {
    maxPayloadBytes: 1048576,
    chunkBytes: 65536,
    maxConcurrentJobs: 4,
    rateLimitPerMinute: 30,
  },
};

// Global rate limiting memory store for POST /v1/reviews
const rateLimitWindowMs = 60 * 1000;
const rateLimitMax = 30;
const rateLimits = new Map<string, number[]>(); // ip -> timestamps

// Middlewares

// Enable CORS
app.use(cors());

// Serve static files from public folder
app.use(express.static(path.join(process.cwd(), 'public')));

// Configure 1 MiB limit for incoming JSON payload
app.use(
  express.json({
    limit: SPEC.limits.maxPayloadBytes,
  })
);

// Payload limit / Invalid JSON Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    res.status(400).json({
      error: {
        code: 'invalid_json',
        message: 'Invalid JSON payload.',
      },
    });
    return;
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({
      error: {
        code: 'payload_too_large',
        message: 'Payload exceeds limit of 1 MiB.',
      },
    });
    return;
  }
  next(err);
});

// Authentication Middleware for /v1/*
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Missing or malformed Authorization header.',
      },
    });
    return;
  }

  const token = authHeader.substring(7);
  if (token !== BEARER_TOKEN) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Invalid bearer token.',
      },
    });
    return;
  }

  next();
};

// Rate Limiter Middleware for POST /v1/reviews
const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let timestamps = rateLimits.get(ip) || [];
  // Filter out timestamps older than 60s
  timestamps = timestamps.filter((t) => now - t < rateLimitWindowMs);

  if (timestamps.length >= rateLimitMax) {
    const oldestTimestamp = timestamps[0];
    const msToWait = rateLimitWindowMs - (now - oldestTimestamp);
    const retryAfterSeconds = Math.max(1, Math.ceil(msToWait / 1000));

    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: 'rate_limited',
        message: 'Rate limit exceeded. Please try again later.',
      },
    });
    return;
  }

  timestamps.push(now);
  rateLimits.set(ip, timestamps);
  next();
};

// Public Routes

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get('/spec', (req: Request, res: Response) => {
  res.status(200).json(SPEC);
});

// Protected V1 Routes

app.use('/v1', authMiddleware);

app.post('/v1/reviews', rateLimitMiddleware, (req: Request, res: Response) => {
  const { diff, options } = req.body;

  // Validate presence and type of diff
  if (typeof diff !== 'string' || !isValidUnifiedDiff(diff)) {
    res.status(422).json({
      error: {
        code: 'invalid_diff',
        message: 'The diff field is missing, empty, or not parseable as a unified diff.',
      },
    });
    return;
  }

  // Parse review options
  const provider = options?.provider === 'llm' ? 'llm' : 'mock';
  const maxFindings = typeof options?.maxFindings === 'number' && options.maxFindings > 0 
    ? options.maxFindings 
    : 100;

  const reviewOptions: ReviewOptions = { provider, maxFindings };

  // Calculate Request Body Hash for Idempotency and Caching checks
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  // 1. Check Idempotency-Key
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
    const record = store.getIdempotencyRecord(idempotencyKey);
    if (record) {
      if (record.bodyHash === bodyHash) {
        // Return existing jobId
        const job = store.getJob(record.jobId);
        if (job) {
          res.status(202).json({
            jobId: job.jobId,
            status: job.status,
          });
          return;
        }
      } else {
        // Body mismatch for the same key -> Conflict
        res.status(409).json({
          error: {
            code: 'idempotency_conflict',
            message: 'Idempotency key conflict: body does not match previous request.',
          },
        });
        return;
      }
    }
  }

  // 2. Check Caching
  const cachedJob = store.findCompletedCache(diff, reviewOptions);
  const jobId = uuidv4();

  // Create the job record in store
  const newJob = store.createJob(jobId, diff, reviewOptions);
  store.addSSEEvent(jobId, 'status', { status: 'queued' });

  // Record idempotency key if present
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
    store.setIdempotencyRecord(idempotencyKey, { jobId, bodyHash });
  }

  if (cachedJob) {
    // Cache hit: complete the job immediately using cached results
    queue.completeFromCache(jobId, cachedJob);
    res.status(202).json({
      jobId,
      status: 'done',
    });
  } else {
    // Cache miss: process asynchronously via the queue
    queue.addJob(jobId);
    res.status(202).json({
      jobId,
      status: 'queued',
    });
  }
});

app.get('/v1/reviews/:jobId', (req: Request, res: Response) => {
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  const job = store.getJob(jobId);

  if (!job) {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Job not found.',
      },
    });
    return;
  }

  const responseBody: any = {
    jobId: job.jobId,
    status: job.status,
    usage: job.usage,
  };

  if (job.status === 'done') {
    responseBody.findings = job.findings || [];
  } else if (job.status === 'failed') {
    responseBody.error = job.error;
  }

  res.status(200).json(responseBody);
});

app.get('/v1/reviews/:jobId/stream', (req: Request, res: Response) => {
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  const job = store.getJob(jobId);

  if (!job) {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Job not found.',
      },
    });
    return;
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event: string, data: string) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${data}\n\n`);
  };

  // Replay existing events
  for (const ev of job.events) {
    sendEvent(ev.event, ev.data);
  }

  // If already finished, close connection immediately after replay
  if (job.status === 'done' || job.status === 'failed') {
    res.end();
    return;
  }

  // If still active, subscribe to new events
  const eventHandler = (ev: { event: string; data: string }) => {
    sendEvent(ev.event, ev.data);
    if (ev.event === 'done') {
      cleanup();
    }
  };

  const cleanup = () => {
    store.off(`event:${jobId}`, eventHandler);
    res.end();
  };

  store.on(`event:${jobId}`, eventHandler);

  // Unsubscribe on client disconnect
  req.on('close', () => {
    store.off(`event:${jobId}`, eventHandler);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`AI Diff Review Service listening on port ${PORT}`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
  console.log(`Service Spec: http://localhost:${PORT}/spec`);
  console.log(`Authorization Token: ${BEARER_TOKEN}`);
});
