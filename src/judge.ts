import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { compileChecker, CheckerCompileResult, getCheckerTimeLimitMs } from './checkerCompiler';
import { runPlainChecker, runTestlibChecker } from './checkerRunner';
import { compileSource } from './compiler';
import { isOutputAccepted } from './comparator';
import { exists, getReportPath, resolveWorkspacePath, toPosixPath } from './config';
import { t } from './i18n';
import { runProcess } from './runner';
import {
  explainRuntimeError,
  renderRuntimeErrorExplanation,
  RuntimeErrorExplanation,
  toRuntimeErrorSummary
} from './runtimeErrorExplainer';
import {
  getLegacyOutputRel,
  getProblemSampleOutputPaths,
  getSampleFileStatus,
  inferSampleSourceType,
  resolveSamplePath
} from './sampleFiles';
import { CheckerSampleReport, CompileStackReport, FileIoConfig, IoMode, JudgeReport, OITestConfig, ProcessResult, SampleConfig, SampleReport } from './types';
import { PlainCheckerParseOptions, resolvePlainCheckerOptions } from './plainCheckerParser';

type RunClassification = 'TLE' | 'RE' | undefined;

type CheckerContext = {
  type: 'testlib' | 'plain';
  source: string;
  exe: string;
  compilerBin?: string;
  testlibPath?: string;
  timeLimitMs: number;
  plainOptions?: Partial<PlainCheckerParseOptions>;
};

type SampleIoContext = {
  mode: IoMode;
  stdin: string;
  cwd: string;
  diagnostics: Pick<SampleReport, 'ioMode' | 'fileIo'>;
};

type FileIoOutput = {
  exists: boolean;
  content: string;
  outputPath: string;
};

export async function runAllSamples(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<JudgeReport | undefined> {
  const totalStartedAt = process.hrtime.bigint();
  output.clear();
  output.show(true);
  output.appendLine('OIjudger');
  output.appendLine(`Source: ${sourcePath}`);
  output.appendLine(`Time limit: ${config.limits.timeMs} ms`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine(`I/O mode: ${getIoMode(config) === 'fileio' ? 'File IO' : 'Standard IO'}`);
  output.appendLine('');

  const compile = await compileSource(workspaceFolder, sourcePath, config, output);
  if (!compile) {
    return undefined;
  }

  const samples: SampleReport[] = [];
  const problemId = (config as { id?: string }).id;
  const runCwd = path.dirname(sourcePath);
  const judgeMode = getJudgeMode(config);
  const activeChecker = judgeMode === 'checker' && config.checker?.enabled && config.checker.type !== 'none'
    ? config.checker
    : undefined;
  output.appendLine(`Judge mode: ${judgeMode === 'checker' ? 'custom checker' : 'normal text compare'}`);
  if (activeChecker) {
    output.appendLine(`Checker type: ${activeChecker.type}`);
  }
  output.appendLine('');

  const checkerCompile = problemId && activeChecker
    ? await compileChecker(workspaceFolder, problemId, config, output)
    : undefined;
  const checkerContext = checkerCompile?.ok
      ? {
        type: checkerCompile.type,
        source: checkerCompile.source,
        exe: checkerCompile.exe,
        compilerBin: checkerCompile.compilerBin,
        testlibPath: checkerCompile.testlib?.testlibPath,
        timeLimitMs: getCheckerTimeLimitMs(activeChecker),
        plainOptions: activeChecker?.type === 'plain' ? resolvePlainCheckerOptions(activeChecker.plain) : undefined
      }
    : undefined;

  if (activeChecker && checkerCompile && !checkerCompile.ok) {
    for (const sample of config.samples) {
      samples.push(createCheckerErrorSampleReport(
        workspaceFolder,
        sourcePath,
        compile.executablePath,
        runCwd,
        sample,
        problemId,
        checkerCompile,
        getIoMode(config),
        getFileIoConfig(config)
      ));
    }
  } else {
    for (const sample of config.samples) {
      samples.push(await judgeSample(
        workspaceFolder,
        sourcePath,
        compile.executablePath,
        runCwd,
        sample,
        config.limits.timeMs,
        getIoMode(config),
        getFileIoConfig(config),
        output,
        problemId,
        compile.stack,
        checkerContext
      ));
    }
  }

  const accepted = samples.filter((sample) => sample.status === 'AC').length;
  const wrongAnswer = samples.filter((sample) => sample.status === 'WA').length;
  const scored = samples.filter((sample) => sample.status === 'Scored').length;
  const checkerError = samples.filter((sample) => sample.status === 'Checker Error').length;
  const earnedScore = samples.reduce((sum, sample) => sum + (sample.score ?? (sample.status === 'AC' ? 1 : 0)), 0);
  const totalTimeMs = elapsedMs(totalStartedAt);
  const report: JudgeReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    sourceName: sourcePath.replace(/^.*[\\/]/u, ''),
    compile: {
      status: compile.status,
      timeMs: compile.timeMs,
      stack: compile.stack
    },
    totalTimeMs,
    judgeMode,
    checkerType: activeChecker?.type === 'testlib' || activeChecker?.type === 'plain' ? activeChecker.type : undefined,
    ioMode: getIoMode(config),
    fileIo: getIoMode(config) === 'fileio' ? getFileIoConfig(config) : undefined,
    checker: activeChecker,
    timeLimitMs: config.limits.timeMs,
    memoryLimitMb: config.limits.memoryMb,
    summary: {
      accepted,
      total: samples.length,
      wrongAnswer,
      scored,
      checkerError
    },
    score: {
      earned: earnedScore,
      total: samples.length
    },
    results: samples,
    samples
  };

  await fs.mkdir(resolveWorkspacePath(workspaceFolder, '.oitest/outputs'), { recursive: true });
  await fs.writeFile(getReportPath(workspaceFolder), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  output.appendLine('');
  output.appendLine(`Summary: ${accepted}/${samples.length} accepted`);
  output.appendLine(`Total judge time: ${formatMs(totalTimeMs)} ms`);
  output.appendLine(`Report: ${problemId ? `.oitest/problems/${problemId}/outputs/report.json` : '.oitest/outputs/report.json'}`);
  if (samples.some((sample) => sample.status === 'Missing')) {
    vscode.window.showWarningMessage(t('someSamplesMissing'));
  }
  if (process.platform === 'win32') {
    output.appendLine(
      'Note: On Windows, sample time includes process startup and pipe I/O overhead, so very small programs may still show tens of milliseconds.'
    );
    output.appendLine(
      '说明：在 Windows 上，样例运行时间包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。'
    );
  }

  return report;
}

function getJudgeMode(config: OITestConfig): 'normal' | 'checker' {
  if (config.judgeMode === 'normal' || config.judgeMode === 'checker') {
    return config.judgeMode;
  }
  return config.checker?.enabled && config.checker.type !== 'none' ? 'checker' : 'normal';
}

function getIoMode(config: OITestConfig): IoMode {
  return config.ioMode === 'fileio' ? 'fileio' : 'stdio';
}

function getFileIoConfig(config: OITestConfig): FileIoConfig {
  return {
    inputFileName: config.fileIo?.inputFileName || 'input.txt',
    outputFileName: config.fileIo?.outputFileName || 'output.txt'
  };
}

async function prepareSampleIo(
  workspaceFolder: vscode.WorkspaceFolder,
  outputPaths: ReturnType<typeof getSampleOutputPaths>,
  sampleInput: string,
  defaultCwd: string,
  ioMode: IoMode,
  fileIo: FileIoConfig
): Promise<SampleIoContext> {
  if (ioMode !== 'fileio') {
    return {
      mode: 'stdio',
      stdin: sampleInput,
      cwd: defaultCwd,
      diagnostics: { ioMode: 'stdio' }
    };
  }

  await fs.rm(outputPaths.runDirPath, { recursive: true, force: true });
  await fs.mkdir(outputPaths.runDirPath, { recursive: true });
  const inputPath = path.join(outputPaths.runDirPath, fileIo.inputFileName);
  await fs.writeFile(inputPath, sampleInput, 'utf8');

  return {
    mode: 'fileio',
    stdin: '',
    cwd: outputPaths.runDirPath,
    diagnostics: createFileIoDiagnostics(outputPaths, fileIo, false)
  };
}

async function readFileIoOutput(
  outputPaths: ReturnType<typeof getSampleOutputPaths>,
  fileIo: FileIoConfig
): Promise<FileIoOutput> {
  const outputPath = path.join(outputPaths.runDirPath, fileIo.outputFileName);
  if (!(await exists(outputPath))) {
    return { exists: false, content: '', outputPath };
  }

  return {
    exists: true,
    content: await fs.readFile(outputPath, 'utf8'),
    outputPath
  };
}

function createFileIoDiagnostics(
  outputPaths: ReturnType<typeof getSampleOutputPaths>,
  fileIo: FileIoConfig,
  outputCreated: boolean
): Pick<SampleReport, 'ioMode' | 'fileIo'> {
  return {
    ioMode: 'fileio',
    fileIo: {
      ...fileIo,
      runDir: outputPaths.runDirRel,
      inputPath: toPosixPath(path.join(outputPaths.runDirRel, fileIo.inputFileName)),
      outputPath: toPosixPath(path.join(outputPaths.runDirRel, fileIo.outputFileName)),
      outputCreated
    }
  };
}

function mergeFileIoOutputDiagnostics(
  diagnostics: Pick<SampleReport, 'ioMode' | 'fileIo'>,
  fileIoOutput: FileIoOutput | undefined
): Pick<SampleReport, 'ioMode' | 'fileIo'> {
  if (diagnostics.ioMode !== 'fileio' || !diagnostics.fileIo || !fileIoOutput) {
    return diagnostics;
  }

  return {
    ioMode: 'fileio',
    fileIo: {
      ...diagnostics.fileIo,
      outputCreated: fileIoOutput.exists
    }
  };
}

async function judgeSample(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  executablePath: string,
  cwd: string,
  sample: SampleConfig,
  timeLimitMs: number,
  ioMode: IoMode,
  fileIo: FileIoConfig,
  output: vscode.OutputChannel,
  problemId?: string,
  compileStack?: CompileStackReport,
  checkerContext?: CheckerContext
): Promise<SampleReport> {
  const fileStatus = await getSampleFileStatus(workspaceFolder, sample);
  const outputPaths = getSampleOutputPaths(workspaceFolder, sample, problemId);

  if (fileStatus.inputMissing || fileStatus.answerMissing) {
    output.appendLine(`[Missing] ${sample.name}`);
    output.appendLine(`  missing sample file: ${fileStatus.missingPaths.join(', ')}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'Missing',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        sourcePath,
        exePath: executablePath,
        cwd,
        killedByTimeout: false,
        ioMode,
        fileIo: ioMode === 'fileio' ? createFileIoDiagnostics(outputPaths, fileIo, false).fileIo : undefined
      },
      'Sample input or expected output file is missing.'
    );
  }

  let input: string;
  let answer: string;
  try {
    input = await fs.readFile(fileStatus.inputPath, 'utf8');
    answer = await fs.readFile(fileStatus.answerPath, 'utf8');
  } catch (error) {
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to read sample files: ${String(error)}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'ERR',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        sourcePath,
        exePath: executablePath,
        cwd,
        killedByTimeout: false,
        spawnError: String(error),
        ioMode,
        fileIo: ioMode === 'fileio' ? createFileIoDiagnostics(outputPaths, fileIo, false).fileIo : undefined
      },
      `Failed to read sample files: ${String(error)}`
    );
  }

  const ioContext = await prepareSampleIo(workspaceFolder, outputPaths, input, cwd, ioMode, fileIo);

  let result: ProcessResult;
  try {
    result = await runProcess(path.resolve(executablePath), [], ioContext.stdin, ioContext.cwd, timeLimitMs);
  } catch (error) {
    const runnerError = formatUnknownError(error);
    await saveTextOutput(outputPaths.outputPath, '');
    await saveTextOutput(outputPaths.stderrPath, runnerError);
    await saveRunResultOutput(outputPaths.runResultPath, 'ERR', {
      stdout: '',
      stderr: runnerError,
      code: null,
      signal: null,
      timedOut: false,
      killedByTimeout: false,
      timeMs: 0,
      elapsedMs: 0
    }, `Failed to start executable: ${runnerError}`, undefined, ioContext.diagnostics);
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to start executable: ${runnerError}`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'ERR',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        sourcePath,
        source: sourcePath,
        exePath: executablePath,
        exe: executablePath,
        cwd: ioContext.cwd,
        killedByTimeout: false,
        spawnError: runnerError,
        runnerError,
        stderrPreview: runnerError,
        ...ioContext.diagnostics
      },
      `Failed to start executable: ${runnerError}`
    );
  }

  const fileIoOutput = ioMode === 'fileio'
    ? await readFileIoOutput(outputPaths, fileIo)
    : undefined;
  const ioDiagnostics = mergeFileIoOutputDiagnostics(ioContext.diagnostics, fileIoOutput);
  const judgeOutput = ioMode === 'fileio' ? (fileIoOutput?.content ?? '') : result.stdout;
  await saveTextOutput(outputPaths.outputPath, judgeOutput);
  await saveTextOutput(outputPaths.stderrPath, result.stderr);
  if (result.stdinError) {
    appendStdinWarning(output, sample.name, result);
  }
  const runStatus = classifyRunResult(result);

  if (runStatus === 'TLE') {
    await saveRunResultOutput(outputPaths.runResultPath, 'TLE', result, 'Time limit exceeded.', undefined, ioDiagnostics);
    output.appendLine(`[TLE] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    appendRuntimeDiagnostics(output, sample.name, {
      sourcePath,
      exePath: executablePath,
      cwd: ioContext.cwd,
      inputPath: fileStatus.inputPath,
      answerPath: fileStatus.answerPath,
      outputPath: outputPaths.outputPath,
      stderrPath: outputPaths.stderrPath,
      timeMs: result.timeMs,
      exitCode: result.code,
      signal: result.signal,
      killedByTimeout: result.killedByTimeout,
      stdinError: result.stdinError,
      stdoutError: result.stdoutError,
      stderrError: result.stderrError,
      stderr: result.stderr
    });
    return createSampleReport(
      workspaceFolder,
      sample,
      'TLE',
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics
      },
      withStdinMessage('Time limit exceeded.', result)
    );
  }

  if (runStatus === 'RE') {
    const runtimeExplanation = explainRuntimeError({
      exitCode: result.code,
      signal: result.signal,
      stderr: result.stderr,
      platform: process.platform
    });
    const message = runtimeExplanation
      ? `Runtime Error: ${runtimeExplanation.englishName}`
      : result.signal
        ? `Runtime error, signal ${result.signal}.`
        : `Runtime error, exit code ${formatExitCode(result.code)}.`;
    await saveRunResultOutput(outputPaths.runResultPath, 'RE', result, message, runtimeExplanation, ioDiagnostics);
    output.appendLine(`[RE] ${sample.name}`);
    if (runtimeExplanation) {
      output.appendLine(renderRuntimeErrorExplanation(runtimeExplanation, { stderrEmpty: !result.stderr.trim() }));
      appendCompileStackLine(output, runtimeExplanation, compileStack);
    }
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    if (result.stderr.trim()) {
      output.appendLine(indent(result.stderr.trimEnd()));
    }
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    appendRuntimeDiagnostics(output, sample.name, {
      sourcePath,
      exePath: executablePath,
      cwd: ioContext.cwd,
      inputPath: fileStatus.inputPath,
      answerPath: fileStatus.answerPath,
      outputPath: outputPaths.outputPath,
      stderrPath: outputPaths.stderrPath,
      timeMs: result.timeMs,
      exitCode: result.code,
      signal: result.signal,
      killedByTimeout: result.killedByTimeout,
      stdinError: result.stdinError,
      stdoutError: result.stdoutError,
      stderrError: result.stderrError,
      stderr: result.stderr
    });
    return createSampleReport(
      workspaceFolder,
      sample,
      'RE',
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics,
        runtimeError: runtimeExplanation ? toRuntimeErrorSummary(runtimeExplanation) : undefined
      },
      withStdinMessage(message, result)
    );
  }

  if (ioMode === 'fileio' && fileIoOutput && !fileIoOutput.exists) {
    const message = t('outputMissingMessage', { name: fileIo.outputFileName });
    await saveRunResultOutput(outputPaths.runResultPath, 'Output Missing', result, message, undefined, ioDiagnostics);
    output.appendLine(`[Output Missing] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    output.appendLine(`  ${message}`);
    output.appendLine(`  run directory: ${outputPaths.runDirRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'Output Missing',
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics
      },
      withStdinMessage(message, result)
    );
  }

  const compareStartedAt = process.hrtime.bigint();
  if (checkerContext) {
    const checkerOutputRel = outputPaths.outputRel.replace(/useroutput\.txt$/u, 'checker-output.txt');
    const checkerStartedAt = process.hrtime.bigint();
    const checkerInput = {
      checkerSource: checkerContext.source,
      checkerExe: checkerContext.exe,
      compilerBin: checkerContext.compilerBin,
      testlibPath: checkerContext.testlibPath,
      inputPath: fileStatus.inputPath,
      userOutputPath: outputPaths.outputPath,
      answerPath: fileStatus.answerPath,
      outputPath: resolveWorkspacePath(workspaceFolder, checkerOutputRel),
      outputRel: checkerOutputRel,
      timeLimitMs: checkerContext.timeLimitMs,
      plainOptions: checkerContext.plainOptions
    };
    const checkerResult = checkerContext.type === 'plain'
      ? await runPlainChecker(checkerInput)
      : await runTestlibChecker(checkerInput);
    await saveRunResultOutput(
      outputPaths.runResultPath,
      checkerResult.status,
      result,
      checkerResult.status === 'Checker Error'
        ? checkerResult.report.message
        : withStdinMessage(checkerResult.report.message ?? '', result),
      undefined,
      ioDiagnostics
    );
    const checkerTimeMs = elapsedMs(checkerStartedAt);
    const scoreSuffix = checkerResult.status === 'Scored' && checkerResult.report.scoreText
      ? ` score ${checkerResult.report.scoreText}`
      : '';
    output.appendLine(`[${checkerResult.status}] ${sample.name}${scoreSuffix} (${formatMs(result.timeMs)} ms, checker ${formatMs(checkerResult.report.timeMs ?? checkerTimeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} checker time: ${formatMs(checkerResult.report.timeMs ?? checkerTimeMs)} ms`);
    if (checkerContext.compilerBin) {
      output.appendLine(`${sample.name} checker PATH includes compiler bin: ${checkerContext.compilerBin}`);
    }
    if (checkerResult.report.message) {
      output.appendLine(indent(checkerResult.report.message));
    }
    return createSampleReport(
      workspaceFolder,
      sample,
      checkerResult.status,
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics
      },
      checkerResult.status === 'Checker Error'
        ? checkerResult.report.message
        : withStdinMessage(checkerResult.report.message ?? '', result),
      checkerResult.score,
      checkerResult.report
    );
  }

  let accepted: boolean;
  try {
    accepted = isOutputAccepted(judgeOutput, answer);
  } catch (error) {
    const compareTimeMs = elapsedMs(compareStartedAt);
    const compareError = formatUnknownError(error);
    await saveRunResultOutput(outputPaths.runResultPath, 'ERR', result, `Failed to compare output: ${compareError}`, undefined, ioDiagnostics);
    output.appendLine(`[ERR] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
    output.appendLine(`  compare error: ${compareError}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'ERR',
      result.timeMs,
      compareTimeMs,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics,
        compareError
      },
      `Failed to compare output: ${compareError}`
    );
  }
  const compareTimeMs = elapsedMs(compareStartedAt);

  if (!accepted) {
    await saveTextOutput(outputPaths.diffPath, createDiffSummary(answer, judgeOutput));
    await saveRunResultOutput(outputPaths.runResultPath, 'WA', result, withStdinMessage('Output differs from answer.', result), undefined, ioDiagnostics);
    output.appendLine(`[WA] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
    output.appendLine(`  answer: ${sample.answer}`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'WA',
      result.timeMs,
      compareTimeMs,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      {
        ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
        ...ioDiagnostics
      },
      withStdinMessage('Output differs from answer.', result)
    );
  }

  await saveTextOutput(outputPaths.diffPath, '');
  await saveRunResultOutput(
    outputPaths.runResultPath,
    'AC',
    result,
    result.stdinError
      ? 'stdin write error occurred after process closed, but process exited successfully.'
      : undefined,
    undefined,
    ioDiagnostics
  );
  output.appendLine(`[AC] ${sample.name} (${formatMs(result.timeMs)} ms)`);
  output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
  output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
  return createSampleReport(
    workspaceFolder,
    sample,
    'AC',
    result.timeMs,
    compareTimeMs,
    outputPaths.outputRel,
    outputPaths.stderrRel,
    outputPaths.diffRel,
    {
      ...createRuntimeDiagnostics(sourcePath, executablePath, ioContext.cwd, result),
      ...ioDiagnostics
    },
    result.stdinError
      ? 'stdin write error occurred after process closed, but process exited successfully.'
      : undefined
  );
}

function createCheckerErrorSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  executablePath: string,
  cwd: string,
  sample: SampleConfig,
  problemId: string | undefined,
  checkerCompile: CheckerCompileResult,
  ioMode: IoMode,
  fileIo: FileIoConfig
): SampleReport {
  const outputPaths = getSampleOutputPaths(workspaceFolder, sample, problemId);
  return createSampleReport(
    workspaceFolder,
    sample,
    'Checker Error',
    0,
    0,
    outputPaths.outputRel,
    outputPaths.stderrRel,
    outputPaths.diffRel,
    {
      sourcePath,
      exePath: executablePath,
      cwd,
      killedByTimeout: false,
      ioMode,
      fileIo: ioMode === 'fileio' ? createFileIoDiagnostics(outputPaths, fileIo, false).fileIo : undefined
    },
    checkerCompile.message ?? 'Checker compile failed.',
    0,
    {
      enabled: true,
      type: checkerCompile.type,
      source: checkerCompile.source,
      exe: checkerCompile.exe,
      testlibPath: checkerCompile.testlib?.testlibPath,
      output: checkerCompile.stderrPath,
      message: checkerCompile.message
    }
  );
}

async function saveTextOutput(filePath: string, text: string): Promise<void> {
  await fs.mkdir(resolveDirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function saveRunResultOutput(
  filePath: string,
  status: SampleReport['status'],
  result: ProcessResult,
  message?: string,
  runtimeExplanation?: RuntimeErrorExplanation,
  io?: SampleIoContext['diagnostics']
): Promise<void> {
  await saveTextOutput(filePath, formatRunResultOutput(status, result, message, runtimeExplanation, io));
}

function formatRunResultOutput(
  status: SampleReport['status'],
  result: ProcessResult,
  message?: string,
  runtimeExplanation?: RuntimeErrorExplanation,
  io?: SampleIoContext['diagnostics']
): string {
  const lines = [
    '[stdout]',
    result.stdout.trimEnd() || '<empty>',
    '',
    '[stderr]',
    result.stderr.trimEnd() || '<empty>',
    '',
    '[runtime]',
    `I/O Mode: ${io?.ioMode === 'fileio' ? 'File IO' : 'Standard IO'}`,
    ...(io?.fileIo?.inputFileName ? [`Input file name: ${io.fileIo.inputFileName}`] : []),
    ...(io?.fileIo?.outputFileName ? [`Output file name: ${io.fileIo.outputFileName}`] : []),
    ...(io?.fileIo?.runDir ? [`Run directory: ${io.fileIo.runDir}`] : []),
    ...(io?.fileIo ? [
      `File output: ${io.fileIo.outputCreated ? `loaded from ${io.fileIo.outputFileName}` : `missing ${io.fileIo.outputFileName}`}`
    ] : []),
    `Status: ${status}`,
    `Exit code: ${formatExitCode(result.code)}`,
    `Signal: ${result.signal ?? 'null'}`,
    `Killed by timeout: ${result.killedByTimeout}`,
    `Time: ${formatMs(result.timeMs)} ms`
  ];

  if (result.stdinError) {
    lines.push(`stdinError: ${result.stdinError}`);
  }
  if (result.stdoutError) {
    lines.push(`stdoutError: ${result.stdoutError}`);
  }
  if (result.stderrError) {
    lines.push(`stderrError: ${result.stderrError}`);
  }
  if (message) {
    lines.push(`Message: ${message}`);
  }
  if (runtimeExplanation) {
    lines.push('', renderRuntimeErrorExplanation(runtimeExplanation, { stderrEmpty: !result.stderr.trim() }));
  }

  return `${lines.join('\n')}\n`;
}

function createSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  status: SampleReport['status'],
  timeMs: number,
  compareTimeMs: number,
  outputRel: string,
  stderrRel: string,
  diffRel: string,
  diagnostics: Partial<Pick<SampleReport, 'source' | 'exe' | 'sourcePath' | 'exePath' | 'cwd' | 'exitCode' | 'signal' | 'killedByTimeout' | 'stdinError' | 'stdoutError' | 'stderrError' | 'stderrPreview' | 'spawnError' | 'runnerError' | 'compareError' | 'runtimeError' | 'ioMode' | 'fileIo'>> = {},
  message?: string,
  score?: number,
  checker?: CheckerSampleReport
): SampleReport {
  const sampleSourceType = inferSampleSourceType(workspaceFolder, sample);
  return {
    id: sample.id,
    index: sample.index,
    name: sample.name,
    status,
    timeMs,
    compareTimeMs,
    elapsedMs: Math.round(timeMs),
    input: resolveSamplePath(workspaceFolder, sample.input),
    answer: resolveSamplePath(workspaceFolder, sample.answer),
    actualOutput: outputRel,
    output: outputRel,
    stderr: stderrRel,
    runResult: deriveRunResultRel(outputRel),
    diff: diffRel,
    sampleSourceType,
    ...diagnostics,
    score,
    checker,
    message
  };
}

function deriveRunResultRel(outputRel: string): string {
  if (/useroutput\.txt$/u.test(outputRel)) {
    return outputRel.replace(/useroutput\.txt$/u, 'run-result.txt');
  }
  if (/\.out$/u.test(outputRel)) {
    return outputRel.replace(/\.out$/u, '.run-result.txt');
  }
  return `${outputRel}.run-result.txt`;
}

function createRuntimeDiagnostics(
  sourcePath: string,
  exePath: string,
  cwd: string,
  result: ProcessResult
): Partial<Pick<SampleReport, 'source' | 'exe' | 'sourcePath' | 'exePath' | 'cwd' | 'exitCode' | 'signal' | 'killedByTimeout' | 'stdinError' | 'stdoutError' | 'stderrError' | 'stderrPreview'>> {
  return {
    source: sourcePath,
    exe: exePath,
    sourcePath,
    exePath,
    cwd,
    exitCode: result.code,
    signal: result.signal,
    killedByTimeout: result.killedByTimeout,
    stdinError: result.stdinError,
    stdoutError: result.stdoutError,
    stderrError: result.stderrError,
    stderrPreview: firstLines(result.stderr, 12)
  };
}

function getSampleOutputPaths(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string | undefined
): {
  outputRel: string;
  outputPath: string;
  stderrRel: string;
  stderrPath: string;
  runResultRel: string;
  runResultPath: string;
  runDirRel: string;
  runDirPath: string;
  diffRel: string;
  diffPath: string;
} {
  if (problemId) {
    const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.index);
    return {
      outputRel: paths.outputRel,
      outputPath: paths.outputPath,
      stderrRel: paths.stderrRel,
      stderrPath: paths.stderrPath,
      runResultRel: paths.runResultRel,
      runResultPath: paths.runResultPath,
      runDirRel: paths.runDirRel,
      runDirPath: paths.runDirPath,
      diffRel: paths.diffRel,
      diffPath: paths.diffPath
    };
  }

  const outputRel = getLegacyOutputRel(sample);
  const outputPath = resolveWorkspacePath(workspaceFolder, outputRel);
  return {
    outputRel,
    outputPath,
    stderrRel: outputRel.replace(/\.out$/u, '.err'),
    stderrPath: outputPath.replace(/\.out$/u, '.err'),
    runResultRel: outputRel.replace(/\.out$/u, '.run-result.txt'),
    runResultPath: outputPath.replace(/\.out$/u, '.run-result.txt'),
    runDirRel: outputRel.replace(/\.out$/u, '-run'),
    runDirPath: outputPath.replace(/\.out$/u, '-run'),
    diffRel: outputRel.replace(/\.out$/u, '.diff'),
    diffPath: outputPath.replace(/\.out$/u, '.diff')
  };
}

function createDiffSummary(answer: string, actual: string): string {
  return [
    'Expected output:',
    answer,
    '',
    'User output:',
    actual
  ].join('\n');
}

function appendRuntimeDiagnostics(
  output: vscode.OutputChannel,
  sampleName: string,
  details: {
    sourcePath: string;
    exePath: string;
    cwd: string;
    inputPath: string;
    answerPath: string;
    outputPath: string;
    stderrPath: string;
    timeMs: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    killedByTimeout: boolean;
    stdinError?: string;
    stdoutError?: string;
    stderrError?: string;
    stderr: string;
  }
): void {
  output.appendLine(`Diagnostics for ${sampleName}:`);
  output.appendLine(`  source: ${details.sourcePath}`);
  output.appendLine(`  exe: ${details.exePath}`);
  output.appendLine(`  cwd: ${details.cwd}`);
  output.appendLine(`  input: ${details.inputPath}`);
  output.appendLine(`  answer: ${details.answerPath}`);
  output.appendLine(`  output: ${details.outputPath}`);
  output.appendLine(`  stderr: ${details.stderrPath}`);
  output.appendLine(`  timeMs: ${formatMs(details.timeMs)}`);
  output.appendLine(`  exitCode: ${details.exitCode ?? 'null'}`);
  output.appendLine(`  signal: ${details.signal ?? 'null'}`);
  output.appendLine(`  killedByTimeout: ${details.killedByTimeout}`);
  output.appendLine(`  stdinError: ${details.stdinError ?? 'none'}`);
  output.appendLine(`  stdoutError: ${details.stdoutError ?? 'none'}`);
  output.appendLine(`  stderrError: ${details.stderrError ?? 'none'}`);
  output.appendLine('  stderr preview:');
  output.appendLine(indent(firstLines(details.stderr, 12) || '(empty)'));
  if (!details.killedByTimeout && details.exitCode === 0 && details.signal === null) {
    output.appendLine('  note: exit code is 0, so runtime status should be decided by output comparison.');
  }
  if (!details.killedByTimeout && details.exitCode === null && details.signal === null) {
    output.appendLine('  warning: invalid RE classification would have no exitCode, signal, spawnError, or runnerError.');
  }
  output.appendLine('  manual reproduce (PowerShell):');
  output.appendLine(`    cd ${quotePowerShell(details.cwd)}`);
  output.appendLine(`    & ${quotePowerShell(details.exePath)} < ${quotePowerShell(details.inputPath)} > ${quotePowerShell(path.join(details.cwd, `manual-useroutput-${slugFilePart(sampleName)}.txt`))} 2> ${quotePowerShell(path.join(details.cwd, `manual-stderr-${slugFilePart(sampleName)}.txt`))}`);
}

function appendStdinWarning(output: vscode.OutputChannel, sampleName: string, result: ProcessResult): void {
  output.appendLine(`${sampleName} stdin write error: ${result.stdinError}`);
  output.appendLine(`Exit code: ${result.code ?? 'null'}`);
  output.appendLine(
    'This does not necessarily mean Runtime Error. Final status is based on exit code and output comparison.'
  );
  output.appendLine('stdin 写入错误不一定代表运行错误；最终状态应根据退出码和输出比较决定。');
}

function withStdinMessage(message: string, result: ProcessResult): string {
  return result.stdinError ? `${message} stdin write error: ${result.stdinError}` : message;
}

function appendCompileStackLine(
  output: vscode.OutputChannel,
  explanation: RuntimeErrorExplanation,
  stack: CompileStackReport | undefined
): void {
  if (explanation.kind !== 'stackOverflow') {
    return;
  }
  output.appendLine(
    stack?.enabled && stack.sizeMb
      ? t('stackOverflowCurrentSize', { size: stack.sizeMb })
      : t('stackOverflowEnableHint')
  );
}

function classifyRunResult(result: ProcessResult): RunClassification {
  if (result.killedByTimeout || result.timedOut) {
    return 'TLE';
  }
  if (result.code !== null && result.code !== 0) {
    return 'RE';
  }
  if (result.signal !== null) {
    return 'RE';
  }
  return undefined;
}

function firstLines(value: string, count: number): string {
  return value
    .split(/\r?\n/u)
    .slice(0, count)
    .join('\n')
    .trimEnd();
}

function quotePowerShell(value: string): string {
  return `"${value.replace(/`/g, '``').replace(/"/g, '`"')}"`;
}

function slugFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'sample';
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatMs(value: number): number {
  return Math.round(value);
}

function formatExitCode(code: number | null): string {
  if (code === null) {
    return 'unknown';
  }
  const unsigned = code >>> 0;
  return `${code} (0x${unsigned.toString(16).toUpperCase().padStart(8, '0')})`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveDirname(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/u, '');
}

function indent(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `  ${line}`)
    .join('\n');
}
