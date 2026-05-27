import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { getOITestDir } from './config';
import { t } from './i18n';
import { runProcess } from './runner';
import { CompileResult, CompileStackReport, OITestConfig, ProcessResult } from './types';

export async function compileSource(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<CompileResult | undefined> {
  const problemId = (config as { id?: string }).id;
  const buildDir = problemId
    ? path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'build')
    : path.join(getOITestDir(workspaceFolder), 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const executableName = process.platform === 'win32' ? 'main.exe' : 'main';
  const executablePath = path.join(buildDir, executableName);
  const { args, stack } = buildCompileArgs(workspaceFolder, config, sourcePath, executablePath);

  output.appendLine(`Compiler: ${config.compiler.command}`);
  output.appendLine(`Compiler family: ${stack.compilerFamily ?? 'unknown'}`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine(`Auto stack size: ${stack.enabled ? 'enabled' : 'disabled'}`);
  if (stack.enabled) {
    output.appendLine(`Stack size: ${stack.sizeMb} MB`);
    output.appendLine(`Stack linker flag: ${stack.flag ?? 'none'}`);
  }
  if (stack.unsupported) {
    output.appendLine(`Auto stack size: unsupported for compiler family: ${stack.compilerFamily ?? 'unknown'}`);
  }
  output.appendLine(`Final compile args: ${args.map(quoteArg).join(' ')}`);
  output.appendLine(`Compile: ${config.compiler.command} ${args.map(quoteArg).join(' ')}`);

  let result: ProcessResult;
  try {
    result = await runProcess(config.compiler.command, args, '', workspaceFolder.uri.fsPath, 60_000);
  } catch (error) {
    output.appendLine(`Compile failed to start: ${String(error)}`);
    vscode.window.showErrorMessage(t('compileStartFailed'));
    return undefined;
  }

  if (result.code !== 0 || result.timedOut) {
    output.appendLine('Compile failed.');
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    if (result.stdout.trim()) {
      output.appendLine(result.stdout.trimEnd());
    }
    vscode.window.showErrorMessage(t('compileFailed'));
    return undefined;
  }

  output.appendLine('Compile succeeded.');
  output.appendLine(`Compile time: ${formatMs(result.timeMs)} ms`);
  output.appendLine('');
  return {
    status: 'OK',
    timeMs: result.timeMs,
    stack,
    executablePath
  };
}

export function buildCompileArgs(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  sourcePath: string,
  executablePath: string
): { args: string[]; stack: CompileStackReport } {
  const stack = getCompileStackReport(config.compiler.command, config);
  const baseArgs = config.compiler.args.map((arg) =>
    arg
      .replace(/\$\{file\}/g, sourcePath)
      .replace(/\$\{output\}/g, executablePath)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath)
      .replace(/\{source\}/g, sourcePath)
      .replace(/\{exe\}/g, executablePath)
  );

  if (!stack.enabled) {
    return { args: baseArgs, stack };
  }

  const args = removeStackArgs(baseArgs);
  if (stack.flag) {
    args.push(stack.flag);
  }
  return { args, stack };
}

function getCompileStackReport(command: string, config: OITestConfig): CompileStackReport {
  const compilerFamily = detectCompilerFamily(command);
  const stackConfig = {
    auto: config.stack?.auto ?? true,
    sizeMb: config.stack?.sizeMb ?? null
  };

  if (!stackConfig.auto) {
    return { enabled: false, compilerFamily };
  }

  const sizeMb = stackConfig.sizeMb ?? config.limits.memoryMb;
  const sizeBytes = sizeMb * 1024 * 1024;
  if (process.platform !== 'win32') {
    return { enabled: false, sizeMb, sizeBytes, compilerFamily, unsupported: true };
  }

  if (compilerFamily === 'gcc' || compilerFamily === 'clang') {
    const flag = `-Wl,--stack,${sizeBytes}`;
    return { enabled: true, sizeMb, sizeBytes, flag, compilerFamily };
  }

  return { enabled: false, sizeMb, sizeBytes, compilerFamily, unsupported: compilerFamily === 'msvc' };
}

function detectCompilerFamily(command: string): string {
  const name = path.basename(command).toLowerCase();
  if (name === 'cl.exe' || name === 'cl') {
    return 'msvc';
  }
  if (name.includes('clang')) {
    return 'clang';
  }
  if (name.includes('g++') || name.includes('gcc') || name.includes('mingw')) {
    return 'gcc';
  }
  return 'unknown';
}

function removeStackArgs(args: string[]): string[] {
  const nextArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (/^-Wl,--stack(?:[=,]\d+)?$/u.test(arg)) {
      if (arg === '-Wl,--stack' && /^\d+$/u.test(args[index + 1] ?? '')) {
        index += 1;
      }
      continue;
    }
    nextArgs.push(arg);
  }
  return nextArgs;
}

function quoteArg(value: string): string {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatMs(value: number): number {
  return Math.round(value);
}
