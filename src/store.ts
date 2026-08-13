import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Job, IdempotencyRecord, Finding, ReviewOptions, JobUsage, SSEEvent } from './types.js';

export function getRequestHash(diff: string, options: ReviewOptions): string {
  const content = JSON.stringify({ diff, options });
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class DataStore extends EventEmitter {
  private jobs = new Map<string, Job>();
  private idempotencyKeys = new Map<string, IdempotencyRecord>();
  private filePath: string;

  constructor() {
    super();
    this.filePath = path.join(process.cwd(), 'data-store.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.jobs) {
          for (const key of Object.keys(data.jobs)) {
            this.jobs.set(key, data.jobs[key]);
          }
        }
        if (data.idempotencyKeys) {
          for (const key of Object.keys(data.idempotencyKeys)) {
            this.idempotencyKeys.set(key, data.idempotencyKeys[key]);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load store from disk:', e);
    }
  }

  private saveTimeout: NodeJS.Timeout | null = null;

  private save() {
    if (this.saveTimeout) {
      return;
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        const data = {
          jobs: Object.fromEntries(this.jobs.entries()),
          idempotencyKeys: Object.fromEntries(this.idempotencyKeys.entries()),
        };
        // Write directly to file to prevent EPERM locks on Windows rename
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (e) {
        console.error('Failed to save store to disk:', e);
      }
    }, 0);
  }

  public getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  public createJob(jobId: string, diff: string, options: ReviewOptions): Job {
    const job: Job = {
      jobId,
      status: 'queued',
      diff,
      options,
      usage: {
        inputBytes: Buffer.byteLength(diff, 'utf-8'),
        chunks: 1, // Will be computed during parsing
        cacheHit: false,
      },
      events: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, job);
    this.save();
    return job;
  }

  public updateJob(jobId: string, updates: Partial<Omit<Job, 'jobId' | 'createdAt'>>): Job {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updatedJob: Job = {
      ...job,
      ...updates,
      updatedAt: Date.now(),
    };

    this.jobs.set(jobId, updatedJob);
    this.save();
    return updatedJob;
  }

  public addSSEEvent(jobId: string, eventType: 'status' | 'finding' | 'done', data: any): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const event: SSEEvent = {
      event: eventType,
      data: JSON.stringify(data),
    };

    job.events.push(event);
    job.updatedAt = Date.now();
    this.jobs.set(jobId, job);
    this.save();

    // Emit live event for active stream subscribers
    this.emit(`event:${jobId}`, event);
  }

  public getIdempotencyRecord(key: string): IdempotencyRecord | undefined {
    return this.idempotencyKeys.get(key);
  }

  public setIdempotencyRecord(key: string, record: IdempotencyRecord): void {
    this.idempotencyKeys.set(key, record);
    this.save();
  }

  public findCompletedCache(diff: string, options: ReviewOptions): Job | undefined {
    const hash = getRequestHash(diff, options);
    for (const job of this.jobs.values()) {
      if (job.status === 'done') {
        const jobHash = getRequestHash(job.diff, job.options);
        if (jobHash === hash) {
          return job;
        }
      }
    }
    return undefined;
  }
}

// Export single shared store instance
export const store = new DataStore();
