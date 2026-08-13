import { store } from './store.js';
import { parseDiff, chunkFiles, splitDiffIntoFiles, getFilePathFromDiff } from './diff-parser.js';
import { runMockRules } from './rules-engine.js';
import { runLlmRules } from './llm-provider.js';
import { Finding, Job, ReviewOptions } from './types.js';

class JobQueue {
  private activeJobsCount = 0;
  private readonly maxConcurrent = 4;
  private queue: string[] = []; // Array of jobIds

  public addJob(jobId: string): void {
    this.queue.push(jobId);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.activeJobsCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const jobId = this.queue.shift();
    if (!jobId) return;

    this.activeJobsCount++;
    this.runJob(jobId).finally(() => {
      this.activeJobsCount--;
      this.processNext();
    });
  }

  private async runJob(jobId: string): Promise<void> {
    const job = store.getJob(jobId);
    if (!job) return;

    try {
      // Transition from queued -> running
      store.updateJob(jobId, { status: 'running' });
      store.addSSEEvent(jobId, 'status', { status: 'running' });

      const { diff, options } = job;

      // 1. Split diff into files, sort alphabetically by path, and group into chunks of max 64 KiB
      const files = splitDiffIntoFiles(diff);
      files.sort((a, b) => {
        const pathA = getFilePathFromDiff(a);
        const pathB = getFilePathFromDiff(b);
        return pathA.localeCompare(pathB);
      });
      const chunks = chunkFiles(files);
      const totalChunks = chunks.length;

      // Update chunks count in usage
      const updatedJob = store.updateJob(jobId, {
        usage: {
          ...job.usage,
          chunks: totalChunks,
        },
      });

      const findingsMap = new Map<string, Finding>();

      // 2. Process chunks one by one
      for (let i = 0; i < totalChunks; i++) {
        const chunkText = chunks[i];
        let chunkFindings: Finding[] = [];

        if (options.provider === 'mock') {
          // Parse this chunk's diff
          const parsed = parseDiff(chunkText);
          chunkFindings = runMockRules(parsed, Infinity);
          // Simulate slight async delay per chunk for realistic scheduling & streaming behavior
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          // LLM Provider
          chunkFindings = await runLlmRules(chunkText, options.maxFindings);
        }

        // Add findings and stream them as they are discovered
        for (const finding of chunkFindings) {
          if (!findingsMap.has(finding.id)) {
            findingsMap.set(finding.id, finding);
            // Stream the finding (cap stream to maxFindings)
            if (findingsMap.size <= options.maxFindings) {
              store.addSSEEvent(jobId, 'finding', finding);
            }
          }
        }
      }

      // Deduplicate and sort all gathered findings
      const finalFindings = Array.from(findingsMap.values());
      finalFindings.sort((a, b) => {
        if (a.path !== b.path) {
          return a.path.localeCompare(b.path);
        }
        if (a.line !== b.line) {
          return a.line - b.line;
        }
        return a.ruleId.localeCompare(b.ruleId);
      });

      const truncatedFindings = finalFindings.slice(0, options.maxFindings);

      // Transition running -> done
      const finalJob = store.updateJob(jobId, {
        status: 'done',
        findings: truncatedFindings,
      });

      store.addSSEEvent(jobId, 'status', { status: 'done' });
      store.addSSEEvent(jobId, 'done', {
        total: truncatedFindings.length,
        usage: finalJob.usage,
      });
    } catch (err: any) {
      console.error(`Error running job ${jobId}:`, err);
      // Transition running -> failed
      const errorMessage = err.message || 'An internal error occurred during review.';
      store.updateJob(jobId, {
        status: 'failed',
        error: {
          code: 'internal',
          message: errorMessage,
        },
      });

      store.addSSEEvent(jobId, 'status', { status: 'failed' });
      store.addSSEEvent(jobId, 'done', {
        total: 0,
        usage: {
          inputBytes: job.usage.inputBytes,
          chunks: job.usage.chunks,
          cacheHit: false,
        },
        error: {
          code: 'internal',
          message: errorMessage,
        },
      });
    }
  }

  // Completes a job immediately using cached results
  public completeFromCache(jobId: string, cachedJob: Job): void {
    const job = store.getJob(jobId);
    if (!job) return;

    // Simulate instant queued -> running -> done sequence
    store.updateJob(jobId, {
      status: 'done',
      findings: cachedJob.findings,
      usage: {
        inputBytes: job.usage.inputBytes,
        chunks: cachedJob.usage.chunks,
        cacheHit: true,
      },
    });

    // Populate events
    store.addSSEEvent(jobId, 'status', { status: 'running' });
    if (cachedJob.findings) {
      for (const finding of cachedJob.findings) {
        store.addSSEEvent(jobId, 'finding', finding);
      }
    }
    store.addSSEEvent(jobId, 'status', { status: 'done' });
    store.addSSEEvent(jobId, 'done', {
      total: cachedJob.findings?.length || 0,
      usage: {
        inputBytes: job.usage.inputBytes,
        chunks: cachedJob.usage.chunks,
        cacheHit: true,
      },
    });
  }
}

export const queue = new JobQueue();
