import { Finding, Severity, Category } from './types.js';
import { ParsedDiff, ParsedAddedLine, ReconstructedFile } from './diff-parser.js';

interface Rule {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  // Trigger function: returns true if the added line triggers the rule
  trigger: (line: ParsedAddedLine, file: ReconstructedFile) => boolean;
}

// Helper to strip comments while preserving strings
function stripComments(code: string): string {
  const regex = /("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\`(?:[^\`\\]|\\.)*\`)|(\/\*[\s\S]*?\*\/)|(\/\/.*)/g;
  return code.replace(regex, (match, dQuote, sQuote, bTick, blockComment, lineComment) => {
    if (blockComment || lineComment) {
      return '';
    }
    return match;
  });
}

function isEmptyCatchBlock(file: ReconstructedFile, lineNum: number): boolean {
  const lineIndex = file.newLineIndexMap.get(lineNum);
  if (lineIndex === undefined) return false;

  const catchLineText = file.allLines[lineIndex];
  if (!/\bcatch\b/.test(catchLineText)) {
    return false;
  }

  // Join lines starting from the catch line to the end of the file/hunk
  const joinedCode = file.allLines.slice(lineIndex).join('\n');
  const cleanCode = stripComments(joinedCode);

  const catchMatch = cleanCode.match(/\bcatch\b/);
  if (!catchMatch || catchMatch.index === undefined) {
    return false;
  }

  const startIdx = catchMatch.index + 5;
  let openBraceIdx = -1;

  for (let i = startIdx; i < cleanCode.length; i++) {
    const char = cleanCode[i];
    if (char === '{') {
      openBraceIdx = i;
      break;
    }
    // Break early if we see other characters that indicate it's not a block-based catch
    if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n' && char !== '(' && char !== ')' && !/[a-zA-Z0-9_$]/.test(char)) {
      // e.g. semicolon or other statements before brace
    }
  }

  if (openBraceIdx === -1) {
    return false;
  }

  let braceDepth = 1;
  let hasContent = false;

  for (let i = openBraceIdx + 1; i < cleanCode.length; i++) {
    const char = cleanCode[i];
    if (char === '{') {
      braceDepth++;
      hasContent = true;
    } else if (char === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        return !hasContent;
      }
    } else {
      if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') {
        hasContent = true;
      }
    }
  }

  return false;
}

function hasSqlConcatenation(content: string): boolean {
  if (!content.includes('+')) {
    return false;
  }

  // Extract all string literals
  const stringLiteralRegex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^\`\\]|\\.)*`/g;
  const matches = content.match(stringLiteralRegex);
  if (!matches) {
    return false;
  }

  // Check if any literal contains a SQL keyword
  const sqlKeywordRegex = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
  let hasSqlKeyword = false;
  for (const match of matches) {
    if (sqlKeywordRegex.test(match)) {
      hasSqlKeyword = true;
      break;
    }
  }

  if (!hasSqlKeyword) {
    return false;
  }

  // Replace all string literals with a placeholder to check if '+' is used outside strings
  const replaced = content.replace(stringLiteralRegex, '_STR_');
  return replaced.includes('+');
}

const RULES: Rule[] = [
  {
    ruleId: 'MOCK-001',
    severity: 'critical',
    category: 'security',
    title: 'eval usage',
    trigger: (line) => stripComments(line.content).includes('eval('),
  },
  {
    ruleId: 'MOCK-002',
    severity: 'critical',
    category: 'security',
    title: 'hardcoded credential',
    trigger: (line) => {
      const regex = /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i;
      return regex.test(line.content);
    },
  },
  {
    ruleId: 'MOCK-003',
    severity: 'high',
    category: 'security',
    title: 'SQL string concatenation',
    trigger: (line) => hasSqlConcatenation(stripComments(line.content)),
  },
  {
    ruleId: 'MOCK-004',
    severity: 'high',
    category: 'correctness',
    title: 'swallowed exception',
    trigger: (line, file) => isEmptyCatchBlock(file, line.line),
  },
  {
    ruleId: 'MOCK-005',
    severity: 'medium',
    category: 'correctness',
    title: 'loose null comparison',
    trigger: (line) => {
      const regex = /(?<!=)(==|!=)(?!=)\s*null/;
      return regex.test(stripComments(line.content));
    },
  },
  {
    ruleId: 'MOCK-006',
    severity: 'medium',
    category: 'performance',
    title: 'deep-clone via JSON',
    trigger: (line) => stripComments(line.content).includes('JSON.parse(JSON.stringify('),
  },
  {
    ruleId: 'MOCK-007',
    severity: 'low',
    category: 'style',
    title: 'console.log left in',
    trigger: (line) => stripComments(line.content).includes('console.log('),
  },
  {
    ruleId: 'MOCK-008',
    severity: 'low',
    category: 'style',
    title: 'unresolved marker',
    trigger: (line) => {
      return line.content.includes('TODO') || line.content.includes('FIXME');
    },
  },
  {
    ruleId: 'MOCK-INJ',
    severity: 'critical',
    category: 'security',
    title: 'prompt-injection content',
    trigger: (line) => {
      const regex = /ignore previous instructions|disregard all prior|you are now/i;
      return regex.test(line.content);
    },
  },
];

export function runMockRules(parsedDiff: ParsedDiff, maxFindings = 100): Finding[] {
  const findings: Finding[] = [];

  for (const file of parsedDiff.files) {
    for (const line of file.addedLines) {
      for (const rule of RULES) {
        if (rule.trigger(line, file)) {
          const finding: Finding = {
            id: `${rule.ruleId}:${line.path}:${line.line}`,
            ruleId: rule.ruleId,
            path: line.path,
            line: line.line,
            severity: rule.severity,
            category: rule.category,
            title: rule.title,
            evidence: `+${line.content}`,
          };
          findings.push(finding);
        }
      }
    }
  }

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

  // Truncate to maxFindings
  return uniqueFindings.slice(0, maxFindings);
}
