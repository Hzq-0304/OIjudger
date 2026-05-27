import * as path from 'path';
import { promises as fs } from 'fs';
import { runProcess } from './runner';
import { CheckerSampleReport } from './types';

export type CheckerRunInput = {
  checkerSource: string;
  checkerExe: string;
  testlibPath?: string;
  inputPath: string;
  userOutputPath: string;
  answerPath: string;
  stdoutPath: string;
  stderrPath: string;
  stdoutRel: string;
  stderrRel: string;
  timeLimitMs: number;
};

export async function runTestlibChecker(input: CheckerRunInput): Promise<{
  status: 'AC' | 'WA' | 'Checker Error';
  score: number;
  report: CheckerSampleReport;
}> {
  await fs.mkdir(path.dirname(input.stdoutPath), { recursive: true });
  const cwd = path.dirname(input.checkerSource);
  try {
    const result = await runProcess(
      input.checkerExe,
      [input.inputPath, input.userOutputPath, input.answerPath],
      '',
      cwd,
      input.timeLimitMs
    );
    await fs.writeFile(input.stdoutPath, result.stdout, 'utf8');
    await fs.writeFile(input.stderrPath, result.stderr, 'utf8');

    const message = extractCheckerMessage(result.stdout, result.stderr);
    if (result.killedByTimeout) {
      return {
        status: 'Checker Error',
        score: 0,
        report: createReport(input, result.code, result.signal, result.timeMs, input.stdoutRel, input.stderrRel, 'Checker timed out.')
      };
    }

    if (result.code === 0 && !result.signal) {
      return {
        status: 'AC',
        score: 1,
        report: createReport(input, result.code, result.signal, result.timeMs, input.stdoutRel, input.stderrRel, message)
      };
    }

    if (result.signal) {
      return {
        status: 'Checker Error',
        score: 0,
        report: createReport(input, result.code, result.signal, result.timeMs, input.stdoutRel, input.stderrRel, `Checker terminated by signal ${result.signal}.`)
      };
    }

    return {
      status: 'WA',
      score: 0,
      report: createReport(input, result.code, result.signal, result.timeMs, input.stdoutRel, input.stderrRel, message || `Checker exited with code ${result.code ?? 'null'}.`)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(input.stdoutPath, '', 'utf8');
    await fs.writeFile(input.stderrPath, message, 'utf8');
    return {
      status: 'Checker Error',
      score: 0,
      report: {
        enabled: true,
        type: 'testlib',
        source: input.checkerSource,
        exe: input.checkerExe,
        testlibPath: input.testlibPath,
        stdout: input.stdoutRel,
        stderr: input.stderrRel,
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
  stdoutRel: string,
  stderrRel: string,
  message?: string
): CheckerSampleReport {
  return {
    enabled: true,
    type: 'testlib',
    source: input.checkerSource,
    exe: input.checkerExe,
    testlibPath: input.testlibPath,
    exitCode,
    signal,
    timeMs,
    stdout: stdoutRel,
    stderr: stderrRel,
    message
  };
}

function extractCheckerMessage(stdout: string, stderr: string): string | undefined {
  const combined = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return combined.slice(0, 5).join('\n') || undefined;
}
