import { PlainCheckerVerdictPosition } from './types';

export type PlainCheckerVerdict =
  | { type: 'AC'; finalLine: string; verdictLine: string; message?: string }
  | { type: 'WA'; finalLine: string; verdictLine: string; message?: string }
  | { type: 'Score'; score: number; scoreText: string; finalLine: string; verdictLine: string; message?: string }
  | { type: 'Invalid'; finalLine?: string; verdictLine?: string; message: string };

export type PlainCheckerParseOptions = {
  verdictPosition: PlainCheckerVerdictPosition;
  acceptedToken: string;
  wrongAnswerToken: string;
};

export type PlainCheckerProtocolValidationIssue =
  | 'acceptedTokenEmpty'
  | 'wrongAnswerTokenEmpty'
  | 'tokensSame'
  | 'acceptedTokenNumeric'
  | 'wrongAnswerTokenNumeric';

const defaultOptions: PlainCheckerParseOptions = {
  verdictPosition: 'lastLine',
  acceptedToken: 'AC',
  wrongAnswerToken: 'WA'
};

export function parsePlainCheckerOutput(
  stdout: string,
  options: Partial<PlainCheckerParseOptions> = {}
): PlainCheckerVerdict {
  const resolved = resolvePlainCheckerOptions(options);
  const nonEmptyLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (nonEmptyLines.length === 0) {
    return { type: 'Invalid', message: getPlainCheckerInvalidMessage(resolved) };
  }

  const verdictIndex = resolved.verdictPosition === 'firstLine' ? 0 : nonEmptyLines.length - 1;
  const verdictLine = nonEmptyLines[verdictIndex];
  const message = nonEmptyLines
    .filter((_, index) => index !== verdictIndex)
    .join('\n') || undefined;

  if (verdictLine === resolved.acceptedToken) {
    return { type: 'AC', finalLine: verdictLine, verdictLine, message };
  }
  if (verdictLine === resolved.wrongAnswerToken) {
    return { type: 'WA', finalLine: verdictLine, verdictLine, message };
  }
  if (isValidScore(verdictLine)) {
    return {
      type: 'Score',
      score: Number(verdictLine),
      scoreText: verdictLine,
      finalLine: verdictLine,
      verdictLine,
      message
    };
  }

  return {
    type: 'Invalid',
    finalLine: verdictLine,
    verdictLine,
    message: getPlainCheckerInvalidMessage(resolved, verdictLine)
  };
}

export function getPlainCheckerInvalidMessage(
  options: Partial<PlainCheckerParseOptions> = {},
  actualLine?: string
): string {
  const resolved = resolvePlainCheckerOptions(options);
  const position = resolved.verdictPosition === 'firstLine' ? 'first' : 'last';
  const lines = [
    'Invalid Plain Checker output.',
    `The current protocol requires the ${position} non-empty stdout line to be one of:`,
    `- ${resolved.acceptedToken}`,
    `- ${resolved.wrongAnswerToken}`,
    '- a numeric score'
  ];
  if (actualLine !== undefined) {
    lines.push('', 'Actual line:', actualLine);
  }
  return lines.join('\n');
}

export function resolvePlainCheckerOptions(
  options: Partial<PlainCheckerParseOptions> = {}
): PlainCheckerParseOptions {
  return {
    verdictPosition: options.verdictPosition === 'firstLine' ? 'firstLine' : defaultOptions.verdictPosition,
    acceptedToken: options.acceptedToken?.trim() || defaultOptions.acceptedToken,
    wrongAnswerToken: options.wrongAnswerToken?.trim() || defaultOptions.wrongAnswerToken
  };
}

export function validatePlainCheckerProtocol(
  options: Partial<Pick<PlainCheckerParseOptions, 'acceptedToken' | 'wrongAnswerToken'>>
): { ok: true } | { ok: false; issue: PlainCheckerProtocolValidationIssue } {
  const acceptedIssue = validatePlainCheckerToken(options.acceptedToken ?? '', 'accepted');
  if (acceptedIssue) {
    return { ok: false, issue: acceptedIssue };
  }
  const wrongAnswerIssue = validatePlainCheckerToken(options.wrongAnswerToken ?? '', 'wrongAnswer');
  if (wrongAnswerIssue) {
    return { ok: false, issue: wrongAnswerIssue };
  }
  const acceptedToken = options.acceptedToken?.trim() ?? '';
  const wrongAnswerToken = options.wrongAnswerToken?.trim() ?? '';
  if (acceptedToken === wrongAnswerToken) {
    return { ok: false, issue: 'tokensSame' };
  }
  return { ok: true };
}

export function validatePlainCheckerToken(
  value: string,
  tokenKind: 'accepted' | 'wrongAnswer'
): PlainCheckerProtocolValidationIssue | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return tokenKind === 'accepted' ? 'acceptedTokenEmpty' : 'wrongAnswerTokenEmpty';
  }
  if (isNumericPlainCheckerToken(trimmed)) {
    return tokenKind === 'accepted' ? 'acceptedTokenNumeric' : 'wrongAnswerTokenNumeric';
  }
  return undefined;
}

export function isNumericPlainCheckerToken(value: string): boolean {
  return isValidScore(value.trim());
}

function isValidScore(value: string): boolean {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}
