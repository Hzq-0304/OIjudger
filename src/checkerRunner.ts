import * as path from 'path';
import { promises as fs } from 'fs';
import { getPlainCheckerInvalidMessage, parsePlainCheckerOutput, PlainCheckerParseOptions, resolvePlainCheckerOptions } from './plainCheckerParser';
import { runProcess } from './runner';
import { getLocale } from './i18n';
import { explainRuntimeError } from './runtimeErrorExplainer';
import { CheckerSampleReport } from './types';
import { mergeCheckerOutput } from './checkerOutput';

export type CheckerRunInput = {
  checkerSource: string;
  checkerExe: string;
  compilerBin?: string;
  testlibPath?: string;
  inputPath: string;
  userOutputPath: string;
  answerPath: string;
  outputPath: string;
  outputRel: string;
  timeLimitMs: number;
  plainOptions?: Partial<PlainCheckerParseOptions>;
};

export async function runTestlibChecker(input: CheckerRunInput): Promise<{
  status: 'AC' | 'WA' | 'Checker Error';
  score: number;
  report: CheckerSampleReport;
}> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const cwd = path.dirname(input.checkerSource);
  const env = createCheckerEnv(input.compilerBin);
  try {
    const result = await runProcess(
      input.checkerExe,
      [input.inputPath, input.userOutputPath, input.answerPath],
      '',
      cwd,
      input.timeLimitMs,
      env
    );
    await writeCheckerOutput(input.outputPath, result.stdout, result.stderr);

    const message = extractCheckerMessage(result.stdout, result.stderr);
    if (result.killedByTimeout) {
      return {
        status: 'Checker Error',
        score: 0,
        report: createReport(input, result.code, result.signal, result.timeMs, 'Checker timed out.', {
          verdict: 'CheckerError',
          errorKind: 'CheckerError',
          errorName: 'Checker Timeout'
        })
      };
    }

    if (result.code === 0 && !result.signal) {
      return {
        status: 'AC',
        score: 1,
        report: createReport(input, result.code, result.signal, result.timeMs, message)
      };
    }

    const abnormalExit = explainCheckerAbnormalExit(result.code, result.signal);
    if (abnormalExit) {
      return {
        status: 'Checker Error',
        score: 0,
        report: createReport(input, result.code, result.signal, result.timeMs, abnormalExit.message, abnormalExit)
      };
    }

    if (result.code === 1) {
      return {
        status: 'WA',
        score: 0,
        report: createReport(input, result.code, result.signal, result.timeMs, message || `Checker exited with code ${result.code}.`, {
          verdict: 'WA'
        })
      };
    }

    return {
      status: 'Checker Error',
      score: 0,
      report: createReport(input, result.code, result.signal, result.timeMs, message || `Checker exited with code ${result.code ?? 'null'}.`, {
        verdict: 'CheckerError',
        errorKind: 'CheckerError',
        errorName: 'Checker Error'
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(input.outputPath, message, 'utf8');
    return {
      status: 'Checker Error',
      score: 0,
      report: {
        enabled: true,
        type: 'testlib',
        source: input.checkerSource,
        exe: input.checkerExe,
        testlibPath: input.testlibPath,
        output: input.outputRel,
        verdict: 'CheckerError',
        errorKind: 'CheckerError',
        errorName: 'Checker Error',
        message: `Checker run failed: ${message}`
      }
    };
  }
}

export async function runPlainChecker(input: CheckerRunInput): Promise<{
  status: 'AC' | 'WA' | 'Scored' | 'Checker Error';
  score: number;
  scoreText?: string;
  report: CheckerSampleReport;
}> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const cwd = path.dirname(input.checkerSource);
  const env = createCheckerEnv(input.compilerBin);
  try {
    const result = await runProcess(
      input.checkerExe,
      [input.inputPath, input.userOutputPath, input.answerPath],
      '',
      cwd,
      input.timeLimitMs,
      env
    );
    await writeCheckerOutput(input.outputPath, result.stdout, result.stderr);

    if (result.killedByTimeout) {
      return {
        status: 'Checker Error',
        score: 0,
        report: createPlainReport(input, result.code, result.signal, result.timeMs, {
          verdict: 'CheckerError',
          errorKind: 'CheckerError',
          errorName: 'Checker Timeout',
          message: 'Checker timed out.'
        })
      };
    }

    const plainOptions = resolvePlainCheckerOptions(input.plainOptions);
    const verdict = parsePlainCheckerOutput(result.stdout, plainOptions);
    if (verdict.type === 'Invalid') {
      const abnormalExit = explainCheckerAbnormalExit(result.code, result.signal);
      if (abnormalExit) {
        return {
          status: 'Checker Error',
          score: 0,
          report: createPlainReport(input, result.code, result.signal, result.timeMs, {
            finalLine: verdict.finalLine,
            verdictLine: verdict.verdictLine,
            verdict: 'CheckerError',
            verdictPosition: plainOptions.verdictPosition,
            acceptedToken: plainOptions.acceptedToken,
            wrongAnswerToken: plainOptions.wrongAnswerToken,
            message: abnormalExit.message,
            errorKind: abnormalExit.errorKind,
            errorName: abnormalExit.errorName
          })
        };
      }
      return {
        status: 'Checker Error',
        score: 0,
        report: createPlainReport(input, result.code, result.signal, result.timeMs, {
          finalLine: verdict.finalLine,
          verdictLine: verdict.verdictLine,
          verdict: 'Invalid',
          verdictPosition: plainOptions.verdictPosition,
          acceptedToken: plainOptions.acceptedToken,
          wrongAnswerToken: plainOptions.wrongAnswerToken,
          message: formatPlainInvalidMessage(plainOptions, verdict.verdictLine)
        })
      };
    }

    const exitWarning = result.code !== 0 || result.signal
      ? `Plain checker returned a non-zero exit code or signal, but a valid final verdict line was parsed. exitCode=${result.code ?? 'null'}, signal=${result.signal ?? 'null'}`
      : undefined;
    const message = [verdict.message, exitWarning].filter(Boolean).join('\n') || undefined;
    if (verdict.type === 'AC') {
      return {
        status: 'AC',
        score: 1,
        report: createPlainReport(input, result.code, result.signal, result.timeMs, {
          finalLine: verdict.finalLine,
          verdictLine: verdict.verdictLine,
          verdict: 'AC',
          verdictPosition: plainOptions.verdictPosition,
          acceptedToken: plainOptions.acceptedToken,
          wrongAnswerToken: plainOptions.wrongAnswerToken,
          message
        })
      };
    }
    if (verdict.type === 'WA') {
      return {
        status: 'WA',
        score: 0,
        report: createPlainReport(input, result.code, result.signal, result.timeMs, {
          finalLine: verdict.finalLine,
          verdictLine: verdict.verdictLine,
          verdict: 'WA',
          verdictPosition: plainOptions.verdictPosition,
          acceptedToken: plainOptions.acceptedToken,
          wrongAnswerToken: plainOptions.wrongAnswerToken,
          message
        })
      };
    }

    return {
      status: 'Scored',
      score: verdict.score,
      scoreText: verdict.scoreText,
      report: createPlainReport(input, result.code, result.signal, result.timeMs, {
        finalLine: verdict.finalLine,
        verdictLine: verdict.verdictLine,
        verdict: 'Score',
        verdictPosition: plainOptions.verdictPosition,
        acceptedToken: plainOptions.acceptedToken,
        wrongAnswerToken: plainOptions.wrongAnswerToken,
        score: verdict.score,
        scoreText: verdict.scoreText,
        message
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(input.outputPath, message, 'utf8');
    return {
      status: 'Checker Error',
      score: 0,
      report: {
        enabled: true,
        type: 'plain',
        source: input.checkerSource,
        exe: input.checkerExe,
        output: input.outputRel,
        verdict: 'CheckerError',
        errorKind: 'CheckerError',
        errorName: 'Checker Error',
        message: `Checker run failed: ${message}`
      }
    };
  }
}

function createReport(
  input: CheckerRunInput,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  timeMs: number,
  message?: string,
  details: {
    verdict?: 'AC' | 'WA' | 'CheckerError';
    errorKind?: CheckerSampleReport['errorKind'];
    errorName?: string;
  } = {}
): CheckerSampleReport {
  return {
    enabled: true,
    type: 'testlib',
    source: input.checkerSource,
    exe: input.checkerExe,
    testlibPath: input.testlibPath,
    exitCode,
    exitCodeHex: typeof exitCode === 'number' ? toHexCode(exitCode) : undefined,
    signal,
    timeMs,
    output: input.outputRel,
    verdict: details.verdict ?? (exitCode === 0 && !signal ? 'AC' : undefined),
    errorKind: details.errorKind,
    errorName: details.errorName,
    message
  };
}

function createPlainReport(
  input: CheckerRunInput,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  timeMs: number,
  details: {
    finalLine?: string;
    verdictLine?: string;
    verdictPosition?: PlainCheckerParseOptions['verdictPosition'];
    acceptedToken?: string;
    wrongAnswerToken?: string;
    verdict: 'AC' | 'WA' | 'Score' | 'Invalid' | 'CheckerError';
    score?: number;
    scoreText?: string;
    errorKind?: CheckerSampleReport['errorKind'];
    errorName?: string;
    message?: string;
  }
): CheckerSampleReport {
  return {
    enabled: true,
    type: 'plain',
    source: input.checkerSource,
    exe: input.checkerExe,
    exitCode,
    exitCodeHex: typeof exitCode === 'number' ? toHexCode(exitCode) : undefined,
    signal,
    timeMs,
    output: input.outputRel,
    finalLine: details.finalLine,
    verdictLine: details.verdictLine ?? details.finalLine,
    verdictPosition: details.verdictPosition,
    acceptedToken: details.acceptedToken,
    wrongAnswerToken: details.wrongAnswerToken,
    verdict: details.verdict,
    errorKind: details.errorKind,
    errorName: details.errorName,
    score: details.score,
    scoreText: details.scoreText,
    message: details.message ?? (details.verdict === 'Invalid' ? getPlainCheckerInvalidMessage(details) : undefined)
  };
}

function extractCheckerMessage(stdout: string, stderr: string): string | undefined {
  const combined = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return combined.slice(0, 5).join('\n') || undefined;
}

function formatPlainInvalidMessage(
  options: PlainCheckerParseOptions,
  actualLine: string | undefined
): string {
  if (getLocale() === 'zh') {
    return [
      'Plain Checker 输出格式无效。',
      `当前协议要求 stdout 的${options.verdictPosition === 'firstLine' ? '第一个' : '最后一个'}非空行必须是：`,
      `- ${options.acceptedToken}`,
      `- ${options.wrongAnswerToken}`,
      '- 数字分数',
      '',
      '实际读取到：',
      actualLine ?? '<empty>'
    ].join('\n');
  }

  return getPlainCheckerInvalidMessage(options, actualLine);
}

async function writeCheckerOutput(outputPath: string, stdout: string, stderr: string): Promise<void> {
  await fs.writeFile(outputPath, mergeCheckerOutput(stdout, stderr), 'utf8');
}

function explainCheckerAbnormalExit(
  exitCode: number | null,
  signal: NodeJS.Signals | null
): {
  message: string;
  errorKind: CheckerSampleReport['errorKind'];
  errorName: string;
  verdict: 'CheckerError';
} | undefined {
  if (signal) {
    const explanation = explainRuntimeError({ signal, platform: process.platform });
    const errorName = explanation?.englishName ?? 'Checker Error';
    return {
      verdict: 'CheckerError',
      errorKind: explanation?.kind ?? 'CheckerError',
      errorName,
      message: formatCheckerErrorMessage(errorName, exitCode, signal, explanation?.englishDescription, explanation?.chineseDescription, explanation?.englishSuggestions, explanation?.chineseSuggestions)
    };
  }
  if (typeof exitCode !== 'number' || exitCode === 0 || !isWindowsExceptionCode(exitCode)) {
    return undefined;
  }

  const explanation = explainRuntimeError({ exitCode, platform: process.platform });
  const errorName = explanation?.englishName ?? 'Unknown runtime error';
  return {
    verdict: 'CheckerError',
    errorKind: explanation?.kind ?? 'CheckerError',
    errorName,
    message: formatCheckerErrorMessage(errorName, exitCode, signal, explanation?.englishDescription, explanation?.chineseDescription, explanation?.englishSuggestions, explanation?.chineseSuggestions)
  };
}

function formatCheckerErrorMessage(
  errorName: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  englishDescription?: string,
  chineseDescription?: string,
  englishSuggestions: string[] = [],
  chineseSuggestions: string[] = []
): string {
  const lines = [`Checker Error: ${errorName}`];
  if (typeof exitCode === 'number') {
    lines.push(`Exit code: ${exitCode} (${toHexCode(exitCode)})`);
  }
  if (signal) {
    lines.push(`Signal: ${signal}`);
  }
  if (getLocale() === 'zh') {
    lines.push(chineseDescription ?? englishDescription ?? '');
    const suggestions = chineseSuggestions.length > 0 ? chineseSuggestions : englishSuggestions;
    if (suggestions.length > 0) {
      lines.push('', '建议:', ...suggestions.map((item) => `- ${item}`));
    }
  } else {
    lines.push(englishDescription ?? '');
    if (englishSuggestions.length > 0) {
      lines.push('', 'Suggestions:', ...englishSuggestions.map((item) => `- ${item}`));
    }
  }
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}

function isWindowsExceptionCode(code: number): boolean {
  return (code >>> 0) >= 0xC0000000;
}

function toHexCode(code: number): string {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function createCheckerEnv(compilerBin: string | undefined): NodeJS.ProcessEnv | undefined {
  if (!compilerBin) {
    return undefined;
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  return {
    ...process.env,
    [pathKey]: `${compilerBin}${path.delimiter}${process.env[pathKey] ?? ''}`
  };
}
