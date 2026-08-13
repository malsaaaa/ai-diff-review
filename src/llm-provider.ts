import { Finding } from './types.js';

export async function runLlmRules(diffText: string, maxFindings = 100): Promise<Finding[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured on the server (GEMINI_API_KEY environment variable is missing).');
  }

  // We call the Gemini API using gemini-3.5-flash which is extremely fast and capable
  const modelName = 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const prompt = `
You are a senior software engineer and security auditor.
Analyze the following unified diff of code changes. Perform a single-pass review of all added lines (lines prefixed with "+").
Identify security vulnerabilities, correctness bugs, performance bottlenecks, and style issues.

Here is the unified diff to review:
\`\`\`diff
${diffText}
\`\`\`

Return a JSON array of findings conforming strictly to the requested schema. Ensure that:
1. Each finding points to an actual added line.
2. The "evidence" contains the offending added line verbatim (including the leading "+" symbol).
3. The "path" matches the file path from the diff.
4. The "line" is the correct line number in the new file.
5. Limit findings to the most important issues up to a maximum of ${maxFindings}.
`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                ruleId: {
                  type: 'STRING',
                  description: 'A machine-readable rule ID, e.g. LLM-SEC-001, LLM-STYLE-002, etc.',
                },
                path: {
                  type: 'STRING',
                  description: 'The path of the file containing the issue.',
                },
                line: {
                  type: 'INTEGER',
                  description: 'The line number of the finding in the NEW file.',
                },
                severity: {
                  type: 'STRING',
                  enum: ['critical', 'high', 'medium', 'low'],
                },
                category: {
                  type: 'STRING',
                  enum: ['security', 'correctness', 'performance', 'style'],
                },
                title: {
                  type: 'STRING',
                  description: 'Short descriptive title of the issue.',
                },
                evidence: {
                  type: 'STRING',
                  description: 'The verbatim line of code containing the issue, including the leading "+" symbol.',
                },
              },
              required: ['ruleId', 'path', 'line', 'severity', 'category', 'title', 'evidence'],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) {
      throw new Error('Gemini API returned an empty or invalid response candidate.');
    }

    const rawFindings = JSON.parse(textResult);
    if (!Array.isArray(rawFindings)) {
      throw new Error('LLM did not return a valid array of findings.');
    }

    // Parse and map findings to match our schema precisely
    const findings: Finding[] = rawFindings.map((f: any) => {
      // Validate path and ensure we generate the correct ID
      const path = typeof f.path === 'string' ? f.path : 'unknown';
      const line = typeof f.line === 'number' ? f.line : 1;
      const ruleId = typeof f.ruleId === 'string' ? f.ruleId : 'LLM-REVIEW';

      return {
        id: `${ruleId}:${path}:${line}`,
        ruleId,
        path,
        line,
        severity: ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
        category: ['security', 'correctness', 'performance', 'style'].includes(f.category) ? f.category : 'correctness',
        title: typeof f.title === 'string' ? f.title : 'AI Review Finding',
        evidence: typeof f.evidence === 'string' ? f.evidence : '',
      };
    });

    // Deduplicate by finding.id
    const seenIds = new Set<string>();
    const uniqueFindings = findings.filter((f) => {
      if (seenIds.has(f.id)) {
        return false;
      }
      seenIds.add(f.id);
      return true;
    });

    // Ordering: path (lexicographic), then line (ascending), then ruleId (lexicographic)
    uniqueFindings.sort((a, b) => {
      if (a.path !== b.path) {
        return a.path.localeCompare(b.path);
      }
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.ruleId.localeCompare(b.ruleId);
    });

    return uniqueFindings.slice(0, maxFindings);
  } catch (error: any) {
    // Fail gracefully with standard clean message
    throw new Error(`LLM service error: ${error.message || error}`);
  }
}
