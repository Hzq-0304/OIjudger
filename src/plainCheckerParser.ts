export type PlainCheckerVerdict =
  | { type: 'AC'; finalLine: string; message?: string }
  | { type: 'WA'; finalLine: string; message?: string }
  | { type: 'Score'; score: number; scoreText: string; finalLine: string; message?: string }
  | { type: 'Invalid'; finalLine?: string; message: string };

const invalidMessage = 'Invalid Plain Checker output. The last non-empty stdout line must be AC, WA, or a numeric score.';

export function parsePlainCheckerOutput(stdout: string): PlainCheckerVerdict {
  const lines = stdout.split(/\r?\n/u);
  const lastIndex = findLastNonEmptyLineIndex(lines);
  if (lastIndex < 0) {
    return { type: 'Invalid', message: invalidMessage };
  }

  const finalLine = lines[lastIndex].trim();
  const message = lines
    .slice(0, lastIndex)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n') || undefined;

  if (/^AC$/iu.test(finalLine)) {
    return { type: 'AC', finalLine, message };
  }
  if (/^WA$/iu.test(finalLine)) {
    return { type: 'WA', finalLine, message };
  }
  if (isValidScore(finalLine)) {
    return {
      type: 'Score',
      score: Number(finalLine),
      scoreText: finalLine,
      finalLine,
      message
    };
  }

  return { type: 'Invalid', finalLine, message: invalidMessage };
}

export function getPlainCheckerInvalidMessage(): string {
  return invalidMessage;
}

function findLastNonEmptyLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      return index;
    }
  }
  return -1;
}

function isValidScore(value: string): boolean {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}
