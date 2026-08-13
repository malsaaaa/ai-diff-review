export interface ParsedAddedLine {
  path: string;
  line: number; // Line number in the new file
  content: string; // Verbatim line text (excluding the leading '+')
}

export interface ReconstructedFile {
  path: string;
  addedLines: ParsedAddedLine[];
  allLines: string[]; // Reconstructed lines of the new file present in the hunks
  newLineIndexMap: Map<number, number>; // Maps new file line number -> index in allLines array
}

export interface ParsedDiff {
  files: ReconstructedFile[];
}

export function isValidUnifiedDiff(diff: string): boolean {
  if (!diff || diff.trim() === '') return false;
  const hasGitHeader = diff.includes('diff --git ');
  const hasFileHeader = diff.includes('--- ') && diff.includes('+++ ');
  const hasHunkHeader = /@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(diff);
  return hasGitHeader || (hasFileHeader && hasHunkHeader) || hasHunkHeader;
}

export function splitDiffIntoFiles(diff: string): string[] {
  const lines = diff.split(/\r?\n/);
  const files: string[][] = [];
  let currentFileLines: string[] = [];

  for (const line of lines) {
    const isNewFile =
      line.startsWith('diff --git ') ||
      line.startsWith('Index: ') ||
      (line.startsWith('--- ') &&
        !line.startsWith('--- /dev/null') &&
        currentFileLines.length > 0 &&
        !currentFileLines[0].startsWith('diff --git') &&
        !currentFileLines[0].startsWith('Index:'));

    if (isNewFile && currentFileLines.length > 0) {
      files.push(currentFileLines);
      currentFileLines = [];
    }
    currentFileLines.push(line);
  }
  if (currentFileLines.length > 0) {
    files.push(currentFileLines);
  }

  return files.map(fileLines => fileLines.join('\n'));
}

export function chunkFiles(files: string[], maxChunkBytes = 65536): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const fileDiff of files) {
    const fileBytes = Buffer.byteLength(fileDiff, 'utf-8');
    const currentBytes = Buffer.byteLength(currentChunk, 'utf-8');

    if (currentChunk === '') {
      currentChunk = fileDiff;
    } else if (currentBytes + 1 + fileBytes > maxChunkBytes) {
      chunks.push(currentChunk);
      currentChunk = fileDiff;
    } else {
      currentChunk += '\n' + fileDiff;
    }
  }

  if (currentChunk !== '') {
    chunks.push(currentChunk);
  }

  return chunks;
}

function cleanPath(p: string): string {
  p = p.trim();
  // Strip quotes if present (sometimes git quotes paths with special characters)
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.substring(1, p.length - 1);
  }
  // Strip prefixes like a/, b/, i/
  if (p.startsWith('b/') || p.startsWith('a/')) {
    return p.substring(2);
  }
  return p;
}

export function getFilePathFromDiff(fileDiff: string): string {
  const lines = fileDiff.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const rawPath = line.substring(4);
      if (rawPath !== '/dev/null') {
        return cleanPath(rawPath);
      }
    }
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      const rawPath = line.substring(4);
      if (rawPath !== '/dev/null') {
        return cleanPath(rawPath);
      }
    }
  }
  return 'unknown';
}


export function parseDiff(diffText: string): ParsedDiff {
  const fileDiffs = splitDiffIntoFiles(diffText);
  const files: ReconstructedFile[] = [];

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split(/\r?\n/);
    let currentPath = '';
    const addedLines: ParsedAddedLine[] = [];
    const allLines: string[] = [];
    const newLineIndexMap = new Map<number, number>();

    let currentLineNumber = 0;
    let inHunk = false;

    for (const line of lines) {
      // Detect file paths from --- and +++ lines
      // Note: we want the path from the +++ line since it represents the target file (new file)
      if (line.startsWith('+++ ')) {
        const rawPath = line.substring(4);
        if (rawPath !== '/dev/null') {
          currentPath = cleanPath(rawPath);
        }
        continue;
      }

      // If we see --- line and don't have a path yet, try to clean it
      if (line.startsWith('--- ') && !currentPath) {
        const rawPath = line.substring(4);
        if (rawPath !== '/dev/null') {
          currentPath = cleanPath(rawPath);
        }
        continue;
      }

      // Detect hunk header
      const hunkHeaderMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkHeaderMatch) {
        currentLineNumber = parseInt(hunkHeaderMatch[1], 10);
        inHunk = true;
        continue;
      }

      if (!inHunk) {
        continue;
      }

      // Inside a hunk, parse lines
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.substring(1);
        addedLines.push({
          path: currentPath || 'unknown',
          line: currentLineNumber,
          content,
        });
        allLines.push(content);
        newLineIndexMap.set(currentLineNumber, allLines.length - 1);
        currentLineNumber++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Deleted line in old file. Does not exist in the new file.
        // Skip it, do not increment currentLineNumber.
        continue;
      } else if (line.startsWith(' ') || line === '') {
        // Context line
        const content = line.startsWith(' ') ? line.substring(1) : line;
        allLines.push(content);
        newLineIndexMap.set(currentLineNumber, allLines.length - 1);
        currentLineNumber++;
      } else if (line.startsWith('\\')) {
        // e.g. "\ No newline at end of file". Skip.
        continue;
      } else {
        // End of hunk or boundary
        inHunk = false;
      }
    }

    if (currentPath && currentPath !== '/dev/null') {
      files.push({
        path: currentPath,
        addedLines,
        allLines,
        newLineIndexMap,
      });
    }
  }

  return { files };
}
