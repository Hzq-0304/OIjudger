import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { getOITestDir } from './config';
import { runProcess } from './runner';
import { resolveTestlibForChecker, TestlibResolveResult } from './testlibResolver';
import { CheckerConfig, OITestConfig } from './types';

export type CheckerCompileResult = {
  ok: boolean;
  type: 'testlib' | 'plain';
  source: string;
  exe: string;
  testlib?: TestlibResolveResult;
  timeMs?: number;
  stderrPath: string;
  message?: string;
};

export async function compileChecker(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<CheckerCompileResult | undefined> {
  const checker = config.checker;
  if (!checker?.enabled || checker.type === 'none' || !checker.source) {
    return undefined;
  }

  const checkerSource = path.isAbsolute(checker.source)
    ? checker.source
    : path.resolve(workspaceFolder.uri.fsPath, checker.source);
  const checkerDir = path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'checker');
  await fs.mkdir(checkerDir, { recursive: true });

  const checkerExe = path.join(checkerDir, process.platform === 'win32' ? 'checker.exe' : 'checker');
  const stderrPath = path.join(checkerDir, 'checker-compile.err');
  const testlib = checker.type === 'testlib'
    ? await resolveTestlibForChecker(workspaceFolder, checkerSource, checker)
    : undefined;

  output.appendLine('');
  output.appendLine('Checker compile:');
  output.appendLine(`  checker type: ${checker.type}`);
  output.appendLine(`  checker source: ${checkerSource}`);
  output.appendLine(`  checker exe: ${checkerExe}`);
  if (checker.type === 'testlib') {
    output.appendLine(`  testlib.h: ${testlib?.testlibPath ?? 'not found'}`);
    output.appendLine(`  testlib source: ${testlib?.source ?? 'missing'}`);
  }

  if (checker.type === 'testlib' && (!testlib?.found || !testlib.includeDir)) {
    const message = 'testlib.h not found. Please run OIjudger: Import testlib.h.';
    await fs.writeFile(stderrPath, `${message}\n`, 'utf8');
    output.appendLine(`  ${message}`);
    return { ok: false, type: checker.type, source: checkerSource, exe: checkerExe, testlib, stderrPath, message };
  }

  const args = [
    checkerSource,
    '-std=c++17',
    '-O2',
    '-Wall'
  ];
  if (checker.type === 'testlib' && testlib?.includeDir) {
    args.push(`-I${testlib.includeDir}`);
  }
  args.push('-o', checkerExe);
  output.appendLine(`  compiler: ${config.compiler.command}`);
  output.appendLine(`  args: ${args.map(quoteArg).join(' ')}`);

  let result;
  try {
    result = await runProcess(config.compiler.command, args, '', workspaceFolder.uri.fsPath, 60_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(stderrPath, message, 'utf8');
    output.appendLine(`  Checker compile failed to start: ${message}`);
    return { ok: false, type: checker.type, source: checkerSource, exe: checkerExe, testlib, stderrPath, message };
  }
  const compileOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  await fs.writeFile(stderrPath, compileOutput, 'utf8');

  if (result.code !== 0 || result.timedOut) {
    const message = result.timedOut
      ? 'Checker compile timed out.'
      : `Checker compile failed with code ${result.code ?? 'null'}.`;
    output.appendLine(`  ${message}`);
    if (compileOutput.trim()) {
      output.appendLine(indent(compileOutput.trimEnd()));
    }
    return { ok: false, type: checker.type, source: checkerSource, exe: checkerExe, testlib, timeMs: result.timeMs, stderrPath, message };
  }

  output.appendLine(`  Checker compile succeeded: ${Math.round(result.timeMs)} ms`);
  return { ok: true, type: checker.type, source: checkerSource, exe: checkerExe, testlib, timeMs: result.timeMs, stderrPath };
}

export async function compileTestlibChecker(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<CheckerCompileResult | undefined> {
  return compileChecker(workspaceFolder, problemId, config, output);
}

export function getCheckerTimeLimitMs(checker: CheckerConfig | undefined): number {
  return checker?.timeLimitMs ?? 5000;
}

function quoteArg(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function indent(value: string): string {
  return value.split(/\r?\n/u).map((line) => `    ${line}`).join('\n');
}
