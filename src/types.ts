export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'security' | 'correctness' | 'performance' | 'style';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type Provider = 'mock' | 'llm';

export interface Finding {
  id: string; // "<ruleId>:<path>:<line>"
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  category: Category;
  title: string;
  evidence: string;
}

export interface JobUsage {
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
}

export interface ReviewOptions {
  provider: Provider;
  maxFindings: number;
}

export interface SSEEvent {
  event: 'status' | 'finding' | 'done';
  data: string;
}

export interface Job {
  jobId: string;
  status: JobStatus;
  diff: string;
  options: ReviewOptions;
  findings?: Finding[];
  error?: {
    code: string;
    message: string;
  };
  usage: JobUsage;
  events: SSEEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface IdempotencyRecord {
  jobId: string;
  bodyHash: string;
}
