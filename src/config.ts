import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { t } from './i18n';
import { CheckerConfig, FileIoConfig, IoMode, JudgeMode, OITestConfig, SampleConfig, StackConfig } from './types';
import {
  normalizeCheckerConfig,
  normalizeFileIoConfig,
  normalizeIoMode,
  normalizeJudgeMode,
  normalizeStackConfig
} from './configNormalize';
import {
  createSampleInternalId,
  getNextSampleIndex,
  getSampleDisplayNameFromInput,
  normalizeSampleInternalId,
  resolveSampleIndex,
  uniqueSampleName
} from './sampleUtils';

export {
  normalizeCheckerConfig,
  normalizeFileIoConfig,
  normalizeIoMode,
  normalizeJudgeMode,
  normalizeStackConfig
} from './configNormalize';
export {
  createSampleInternalId,
  getNextSampleIndex,
  getSampleDisplayNameFromInput,
  getSampleOutputDirRel,
  normalizeSampleInternalId,
  resolveSampleIndex,
  uniqueSampleName
} from './sampleUtils';

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder;
    }
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage(t('openWorkspaceFolder'));
  }
  return folder;
}

export function getOITestDir(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, '.oitest');
}

export function getConfigPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'config.json');
}

export function getOutputsDir(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'outputs');
}

export function getReportPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOutputsDir(workspaceFolder), 'report.json');
}

export function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): string {
  return path.resolve(workspaceFolder.uri.fsPath, relativePath);
}

export async function initProblem(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'samples'), { recursive: true });
  await fs.mkdir(getOutputsDir(workspaceFolder), { recursive: true });
  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'build'), { recursive: true });

  const configPath = getConfigPath(workspaceFolder);
  if (await exists(configPath)) {
    return readConfig(workspaceFolder);
  }

  const config = createDefaultConfig();
  await writeConfig(workspaceFolder, config);
  return config;
}

export async function ensureConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return initProblem(workspaceFolder);
  }
  return readConfig(workspaceFolder);
}

export async function readConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  const raw = await fs.readFile(getConfigPath(workspaceFolder), 'utf8');
  const config = normalizeConfig(JSON.parse(raw) as OITestConfig);

  config.samples = config.samples.map((sample, index) => normalizeSample(sample, index + 1));
  return config;
}

export async function writeConfig(workspaceFolder: vscode.WorkspaceFolder, config: OITestConfig): Promise<void> {
  await fs.mkdir(path.dirname(getConfigPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getConfigPath(workspaceFolder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function addSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  input: string,
  answer: string,
  options: { decodeEscapes?: boolean } = {}
): Promise<SampleConfig> {
  const index = getNextSampleIndex(config);
  const sample: SampleConfig = {
    id: createSampleInternalId(index),
    index,
    name: `Sample ${index}`,
    input: toPosixPath(path.join('.oitest', 'samples', `${index}.in`)),
    answer: toPosixPath(path.join('.oitest', 'samples', `${index}.ans`)),
    actualOutput: toPosixPath(path.join('.oitest', 'outputs', `${index}.out`)),
    sourceType: 'managed'
  };

  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'samples'), { recursive: true });
  const shouldDecodeEscapes = options.decodeEscapes ?? true;
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, sample.input), formatSampleText(input, shouldDecodeEscapes), 'utf8');
  await fs.writeFile(
    resolveWorkspacePath(workspaceFolder, sample.answer),
    formatSampleText(answer, shouldDecodeEscapes),
    'utf8'
  );

  config.samples.push(sample);
  await writeConfig(workspaceFolder, config);
  return sample;
}

export async function setTimeLimit(workspaceFolder: vscode.WorkspaceFolder, timeMs: number): Promise<void> {
  const config = await ensureConfig(workspaceFolder);
  config.limits.timeMs = timeMs;
  await writeConfig(workspaceFolder, config);
}

export async function addExternalSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  inputPath: string,
  answerPath: string
): Promise<SampleConfig> {
  const index = getNextSampleIndex(config);
  const baseName = getSampleDisplayNameFromInput(inputPath);
  const sample: SampleConfig = {
    id: createSampleInternalId(index),
    index,
    name: uniqueSampleName(config.samples, baseName),
    input: path.resolve(inputPath),
    answer: path.resolve(answerPath),
    actualOutput: toPosixPath(path.join('.oitest', 'outputs', `${index}.out`)),
    sourceType: 'external'
  };

  config.samples.push(sample);
  await writeConfig(workspaceFolder, config);
  return sample;
}

export async function setMemoryLimit(workspaceFolder: vscode.WorkspaceFolder, memoryMb: number): Promise<void> {
  const config = await ensureConfig(workspaceFolder);
  config.limits.memoryMb = memoryMb;
  await writeConfig(workspaceFolder, config);
}

export async function setStackConfig(workspaceFolder: vscode.WorkspaceFolder, stack: StackConfig): Promise<void> {
  const config = await ensureConfig(workspaceFolder);
  config.stack = stack;
  await writeConfig(workspaceFolder, config);
}

export async function clearOutputs(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const outputsDir = getOutputsDir(workspaceFolder);
  await fs.rm(outputsDir, { recursive: true, force: true });
  await fs.mkdir(outputsDir, { recursive: true });
}

export function createDefaultConfig(): OITestConfig {
  return {
    version: 1,
    compile: {
      command: 'g++',
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    compiler: {
      command: 'g++',
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    limits: {
      timeMs: 1000,
      memoryMb: 256
    },
    stack: {
      auto: true,
      sizeMb: null
    },
    judgeMode: 'normal',
    ioMode: 'stdio',
    fileIo: {
      inputFileName: 'input.txt',
      outputFileName: 'output.txt'
    },
    checker: {
      enabled: false,
      type: 'none'
    },
    samples: []
  };
}

export function setCompilerCommand(config: OITestConfig, command: string): OITestConfig {
  config.compiler.command = command;
  config.compile = {
    command,
    args: config.compile?.args ?? config.compiler.args
  };
  return config;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isCppFile(filePath: string): boolean {
  return ['.cpp', '.cc', '.cxx', '.c++'].includes(path.extname(filePath).toLowerCase());
}

export function validatePositiveInteger(value: string): string | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return t('positiveInteger');
  }
  return undefined;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeSample(sample: SampleConfig, fallbackIndex: number): SampleConfig {
  const index = resolveSampleIndex(sample, fallbackIndex);
  const answer = sample.answer ?? sample.expectedOutput ?? toPosixPath(path.join('.oitest', 'samples', `${index}.ans`));
  return {
    ...sample,
    id: normalizeSampleInternalId(sample.id, index),
    index,
    name: sample.name ?? `Sample ${index}`,
    answer,
    actualOutput: sample.actualOutput ?? toPosixPath(path.join('.oitest', 'outputs', `${index}.out`)),
    sourceType: sample.sourceType ?? inferConfigSampleSourceType(sample)
  };
}

function normalizeConfig(config: OITestConfig): OITestConfig {
  const defaultConfig = createDefaultConfig();
  const compiler = config.compiler ?? config.compile ?? defaultConfig.compiler;
  const compile = config.compile ?? compiler;
  return {
    ...defaultConfig,
    ...config,
    compiler: {
      command: compiler.command || compile.command || defaultConfig.compiler.command,
      args: compiler.args ?? compile.args ?? defaultConfig.compiler.args
    },
    compile: {
      command: compile.command || compiler.command || defaultConfig.compile?.command || 'g++',
      args: compile.args ?? compiler.args ?? defaultConfig.compile?.args ?? defaultConfig.compiler.args
    },
    limits: {
      ...defaultConfig.limits,
      ...config.limits
    },
    stack: normalizeStackConfig(config.stack),
    judgeMode: normalizeJudgeMode(config.judgeMode, config.checker),
    ioMode: normalizeIoMode(config.ioMode),
    fileIo: normalizeFileIoConfig(config.fileIo),
    checker: normalizeCheckerConfig(config.checker),
    samples: config.samples ?? []
  };
}

function inferConfigSampleSourceType(sample: SampleConfig): SampleConfig['sourceType'] {
  return path.isAbsolute(sample.input) || path.isAbsolute(sample.answer) ? 'external' : 'managed';
}

function decodeEscapes(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function formatSampleText(value: string, shouldDecodeEscapes: boolean): string {
  return shouldDecodeEscapes ? decodeEscapes(value) : value;
}
