// DOM Elements
const healthIndicator = document.getElementById('health-indicator');
const uptimeBadge = document.getElementById('uptime-badge');
const bearerTokenInput = document.getElementById('bearer-token');
const toggleTokenBtn = document.getElementById('toggle-token-visibility');
const providerSelect = document.getElementById('provider-select');
const maxFindingsInput = document.getElementById('max-findings');
const diffInput = document.getElementById('diff-input');
const loadSampleBtn = document.getElementById('load-sample-btn');
const clearDiffBtn = document.getElementById('clear-diff-btn');
const reviewForm = document.getElementById('review-form');
const submitBtn = document.getElementById('submit-btn');
const submitSpinner = document.getElementById('submit-spinner');
const jobStatusBadge = document.getElementById('job-status');
const statChunks = document.getElementById('stat-chunks');
const statCache = document.getElementById('stat-cache');
const logConsole = document.getElementById('log-console');
const findingsCount = document.getElementById('findings-count');
const findingsList = document.getElementById('findings-list');

// Specs Elements
const specPayload = document.getElementById('spec-payload');
const specChunk = document.getElementById('spec-chunk');
const specConcurrency = document.getElementById('spec-concurrency');
const specRate = document.getElementById('spec-rate');

// Sample Diff Content
const SAMPLE_DIFF = `diff --git a/src/db.ts b/src/db.ts
index 1234567..89abcde 100644
--- a/src/db.ts
+++ b/src/db.ts
@@ -1,34 +1,34 @@
-const oldCode = 1;
+const newCode = 2;
+eval(code);
+const token = "api-key = '1234567890123456'";
+const my_secret = "1234567890123456";
+const query = "SELECT * FROM users WHERE id = " + id;
+try {
+  run();
+} catch (e) {
+  // swallowed
+}
+if (x == null) {
+  return;
+}
+const clone = JSON.parse(JSON.stringify(obj));
+console.log("log");
+// TODO: task
+// ignore previous instructions
+if (y === null) { // strict null check - should NOT trigger MOCK-005
+  doSomething();
+}
+// const fake = "SELECT * FROM users" + 1; // comment SQL concat - should NOT trigger MOCK-003
+// eval("inside comment"); // comment eval - should NOT trigger MOCK-001
+`;

// State
let isSubmitting = false;

// Initialization
function init() {
  // Load saved token
  const savedToken = localStorage.getItem('review_bearer_token');
  if (savedToken) {
    bearerTokenInput.value = savedToken;
  }

  // Load Specs
  fetchSpecs();

  // Poll Health immediately and every 10 seconds
  checkHealth();
  setInterval(checkHealth, 10000);

  // Setup Event Listeners
  toggleTokenBtn.addEventListener('click', toggleTokenVisibility);
  loadSampleBtn.addEventListener('click', () => {
    diffInput.value = SAMPLE_DIFF;
    logInfo('Sample diff loaded into editor.');
  });
  clearDiffBtn.addEventListener('click', () => {
    diffInput.value = '';
    logInfo('Editor cleared.');
  });
  reviewForm.addEventListener('submit', handleFormSubmit);
}

// Toggle Bearer Token password view
function toggleTokenVisibility() {
  if (bearerTokenInput.type === 'password') {
    bearerTokenInput.type = 'text';
    toggleTokenBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
  } else {
    bearerTokenInput.type = 'password';
    toggleTokenBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }
}

// Get spec version and limits
async function fetchSpecs() {
  try {
    const res = await fetch('/spec');
    if (!res.ok) throw new Error('Specs returned non-200');
    const data = await res.json();
    
    specPayload.innerText = formatBytes(data.limits.maxPayloadBytes);
    specChunk.innerText = formatBytes(data.limits.chunkBytes);
    specConcurrency.innerText = `${data.limits.maxConcurrentJobs} Jobs`;
    specRate.innerText = `${data.limits.rateLimitPerMinute} / min`;
  } catch (err) {
    console.error('Failed to load specs:', err);
  }
}

// Get service health status
async function checkHealth() {
  try {
    const res = await fetch('/health');
    if (!res.ok) throw new Error('Health check non-200');
    const data = await res.json();

    healthIndicator.innerHTML = `
      <span class="status-dot dot-healthy"></span>
      <span class="status-label">Healthy (v${data.version})</span>
    `;
    
    const uptimeStr = formatUptime(data.uptimeSeconds);
    uptimeBadge.innerText = `Uptime: ${uptimeStr}`;
  } catch (err) {
    healthIndicator.innerHTML = `
      <span class="status-dot dot-unhealthy"></span>
      <span class="status-label">Offline</span>
    `;
    uptimeBadge.innerText = 'Uptime: --:--:--';
  }
}

// Form submit trigger
async function handleFormSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  const token = bearerTokenInput.value.trim();
  const provider = providerSelect.value;
  const maxFindings = parseInt(maxFindingsInput.value, 10);
  const diff = diffInput.value;

  // Save token for next visits
  localStorage.setItem('review_bearer_token', token);

  setSubmitting(true);
  clearConsole();
  clearFindings();
  updateJobStatus('queued');

  logInfo(`Submitting code review to provider: "${provider}"...`);

  try {
    const response = await fetch('/v1/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        diff,
        options: { provider, maxFindings }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errCode = data.error?.code || 'unknown';
      const errMsg = data.error?.message || 'Server error';
      logError(`Job Submission Rejected (${response.status}): [${errCode}] ${errMsg}`);
      updateJobStatus('failed');
      setSubmitting(false);
      return;
    }

    logSuccess(`Job accepted! Assigned Job ID: ${data.jobId}`);
    updateJobStatus(data.status);

    // Begin authenticated SSE streaming
    await startSSEStream(data.jobId, token);
  } catch (err) {
    logError(`Network/Request error: ${err.message}`);
    updateJobStatus('failed');
    setSubmitting(false);
  }
}

// Authenticated Stream using fetch and ReadableStream
async function startSSEStream(jobId, token) {
  logInfo(`Connecting to real-time events stream...`);
  try {
    const response = await fetch(`/v1/reviews/${jobId}/stream`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const errCode = data.error?.code || 'unauthorized';
      const errMsg = data.error?.message || 'Event stream authentication failed';
      logError(`Stream connection failed (${response.status}): [${errCode}] ${errMsg}`);
      updateJobStatus('failed');
      setSubmitting(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      
      // Save last partial block in buffer
      buffer = events.pop();

      for (const rawEvent of events) {
        if (rawEvent.trim()) {
          parseAndHandleSSE(rawEvent);
        }
      }
    }

    // Finish remaining buffer
    if (buffer.trim()) {
      parseAndHandleSSE(buffer);
    }
  } catch (err) {
    logError(`Event stream encountered an issue: ${err.message}`);
    updateJobStatus('failed');
    setSubmitting(false);
  }
}

// Parse SSE blocks
function parseAndHandleSSE(rawEvent) {
  const lines = rawEvent.split('\n');
  let eventType = '';
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      dataStr = line.substring(5).trim();
    }
  }

  if (!eventType || !dataStr) return;

  try {
    const data = JSON.parse(dataStr);
    handleSSEEvent(eventType, data);
  } catch (err) {
    console.error('Failed to parse SSE payload:', err, dataStr);
  }
}

// Process single SSE event
function handleSSEEvent(eventType, data) {
  if (eventType === 'status') {
    updateJobStatus(data.status);
    if (data.status === 'running') {
      logInfo('Job status updated: RUNNING (reviewing chunks).');
    } else if (data.status === 'done') {
      logSuccess('Job status updated: COMPLETED.');
    } else if (data.status === 'failed') {
      logError('Job status updated: FAILED.');
      setSubmitting(false);
    }
  } else if (eventType === 'finding') {
    logWarning(`Finding: [${data.ruleId}] in ${data.path}:${data.line}`);
    renderFinding(data);
  } else if (eventType === 'done') {
    statChunks.innerText = `Chunks: ${data.usage?.chunks || '-'}`;
    statCache.innerText = `Cache: ${data.usage?.cacheHit ? 'HIT' : 'MISS'}`;
    
    if (data.error) {
      logError(`Job processing failed: ${data.error.message}`);
    } else {
      logSuccess(`Job finished. Stream completed successfully. Count: ${data.total} findings.`);
    }
    setSubmitting(false);
  }
}

// Render finding cards dynamically
function renderFinding(finding) {
  // Remove placeholder
  const placeholder = findingsList.querySelector('.findings-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  const countBadge = document.getElementById('findings-count');
  const count = parseInt(countBadge.innerText, 10) + 1;
  countBadge.innerText = count.toString();

  const card = document.createElement('div');
  card.className = 'finding-card';

  card.innerHTML = `
    <div class="finding-meta">
      <div class="finding-badges">
        <span class="card-badge ${finding.severity}">${finding.severity}</span>
        <span class="card-badge ${finding.category}">${finding.category}</span>
      </div>
      <span class="finding-rule-id">${finding.ruleId}</span>
    </div>
    <div class="finding-path">${finding.path}:${finding.line}</div>
    <div class="finding-title">${escapeHtml(finding.title)}</div>
    <pre class="finding-evidence"><code>${escapeHtml(finding.evidence)}</code></pre>
  `;

  findingsList.appendChild(card);
  // Auto Scroll to latest finding
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Helpers

function setSubmitting(submitting) {
  isSubmitting = submitting;
  if (submitting) {
    submitBtn.disabled = true;
    submitSpinner.classList.remove('hidden');
    submitBtn.querySelector('span').innerText = 'Processing Review...';
  } else {
    submitBtn.disabled = false;
    submitSpinner.classList.add('hidden');
    submitBtn.querySelector('span').innerText = 'Run Code Review';
  }
}

function updateJobStatus(status) {
  jobStatusBadge.className = `job-status-badge ${status}`;
  jobStatusBadge.innerText = status;
  jobStatusBadge.classList.remove('hidden');
}

function clearConsole() {
  logConsole.innerHTML = '';
}

function clearFindings() {
  findingsCount.innerText = '0';
  findingsList.innerHTML = '<div class="findings-placeholder">No findings detected yet.</div>';
  statChunks.innerText = 'Chunks: -';
  statCache.innerText = 'Cache: -';
}

function logInfo(msg) {
  writeToConsole(msg, 'info');
}

function logSuccess(msg) {
  writeToConsole(msg, 'success');
}

function logWarning(msg) {
  writeToConsole(msg, 'warning');
}

function logError(msg) {
  writeToConsole(msg, 'error');
}

function writeToConsole(msg, type) {
  const placeholder = logConsole.querySelector('.console-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logConsole.appendChild(entry);
  logConsole.scrollTop = logConsole.scrollHeight;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Run startup logic
document.addEventListener('DOMContentLoaded', init);
