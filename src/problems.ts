import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  createDefaultConfig,
  exists,
  getConfigPath,
  getOITestDir,
  readConfig,
  normalizeStackConfig,
  resolveWorkspacePath,
  setCompilerCommand,
  toPosixPath
} from './config';
import {
  getProblemSampleOutputPaths,
  inferSampleSourceType,
  isUnderPath,
  resolveSamplePath
} from './sampleFiles';
import {
  JudgeReport,
  OITestConfig,
  ProblemConfig,
  ProblemsConfig,
  ProblemSource,
  ProblemStatementType,
  SampleConfig
} from './types';

export function getProblemsPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'problems.json');
}

export function getProblemRoot(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getOITestDir(workspaceFolder), 'problems', problemId);
}

export function getProblemReportPath(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getProblemRoot(workspaceFolder, problemId), 'outputs', 'report.json');
}

export function getProblemConfigPath(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getProblemRoot(workspaceFolder, problemId), 'config.json');
}

export async function ensureProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  if (!(await exists(getProblemsPath(workspaceFolder)))) {
    const config: ProblemsConfig = { version: 1, problems: [] };
    await writeProblemsConfig(workspaceFolder, config);
    return config;
  }
  return readProblemsConfig(workspaceFolder);
}

export async function readProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  const raw = await fs.readFile(getProblemsPath(workspaceFolder), 'utf8');
  const parsed = JSON.parse(raw) as ProblemsConfig;
  return {
    version: 1,
    problems: (parsed.problems ?? []).map((problem) => normalizeProblem(workspaceFolder, problem))
  };
}

export async function writeProblemsConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: ProblemsConfig
): Promise<void> {
  await fs.mkdir(path.dirname(getProblemsPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getProblemsPath(workspaceFolder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await Promise.all(config.problems.map((problem) => writeProblemConfig(workspaceFolder, problem)));
}

export async function createProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  name: string
): Promise<ProblemConfig> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem: ProblemConfig = {
    ...createDefaultConfig(),
    id: createProblemId(name, problems),
    name: createProblemName(name, problems),
    standard: 'c++17',
    sources: []
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function addProblemFromSource(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string
): Promise<ProblemConfig> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const relativeSource = toPosixPath(path.relative(workspaceFolder.uri.fsPath, sourcePath));
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const problem: ProblemConfig = {
    ...createDefaultConfig(),
    id: createProblemId(baseName, problems),
    name: createProblemName(baseName, problems),
    source: relativeSource,
    defaultSource: relativeSource,
    sources: [createProblemSource(workspaceFolder, sourcePath)],
    standard: 'c++17'
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function importLegacyProblem(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemConfig | undefined> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return undefined;
  }
  const legacy = await readConfig(workspaceFolder);
  const problems = await ensureProblemsConfig(workspaceFolder);
  const source = guessLegacySource(workspaceFolder);
  const baseName = source ? path.basename(source, path.extname(source)) : 'legacy';
  const problem: ProblemConfig = {
    ...legacy,
    id: createProblemId(baseName, problems),
    name: createProblemName(baseName, problems),
    source: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : '',
    defaultSource: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : undefined,
    sources: source ? [createProblemSource(workspaceFolder, source)] : [],
    standard: getStandardFromArgs(legacy.compiler.args)
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  const copiedSamples: SampleConfig[] = [];
  for (const sample of legacy.samples) {
    const input = await readOptional(resolveWorkspacePath(workspaceFolder, sample.input));
    const answer = await readOptional(resolveWorkspacePath(workspaceFolder, sample.answer));
    copiedSamples.push(await addProblemSampleFiles(workspaceFolder, problem, input, answer));
  }
  problem.samples = copiedSamples;
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function addProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  input: string,
  answer: string,
  options: { decodeEscapes?: boolean } = {}
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  const sample = await addProblemSampleFiles(
    workspaceFolder,
    problem,
    formatSampleText(input, options.decodeEscapes ?? true),
    formatSampleText(answer, options.decodeEscapes ?? true)
  );
  problem.samples.push(sample);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function addExternalProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  inputPath: string,
  answerPath: string
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  await ensureProblemFolders(workspaceFolder, problem.id);
  const id = nextSampleId(problem);
  const outputRel = getProblemSampleOutputPaths(workspaceFolder, problem.id, id).outputRel;
  const sample: SampleConfig = {
    id,
    name: `Sample ${id}`,
    input: path.resolve(inputPath),
    answer: path.resolve(answerPath),
    actualOutput: outputRel,
    sourceType: 'external'
  };

  problem.samples.push(sample);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function batchAddExternalProblemSamples(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  pairs: Array<{ inputPath: string; answerPath: string }>
): Promise<{ added: SampleConfig[]; duplicates: Array<{ inputPath: string; answerPath: string }> } | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  await ensureProblemFolders(workspaceFolder, problem.id);
  const added: SampleConfig[] = [];
  const duplicates: Array<{ inputPath: string; answerPath: string }> = [];

  for (const pair of pairs) {
    const inputPath = path.resolve(pair.inputPath);
    const answerPath = path.resolve(pair.answerPath);
    const duplicate = problem.samples.some((sample) => sample.input === inputPath && sample.answer === answerPath);
    if (duplicate) {
      duplicates.push({ inputPath, answerPath });
      continue;
    }

    const id = nextSampleId(problem);
    const sample: SampleConfig = {
      id,
      name: `Sample ${id}`,
      input: inputPath,
      answer: answerPath,
      actualOutput: getProblemSampleOutputPaths(workspaceFolder, problem.id, id).outputRel,
      sourceType: 'external'
    };
    problem.samples.push(sample);
    added.push(sample);
  }

  if (added.length > 0) {
    await writeProblemsConfig(workspaceFolder, problems);
  }
  return { added, duplicates };
}

export async function updateProblemLimits(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  limits: Partial<ProblemConfig['limits']>
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.limits = { ...problem.limits, ...limits };
  });
}

export async function updateProblemStack(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  stack: ProblemConfig['stack']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.stack = normalizeStackConfig(stack);
  });
}

export async function updateProblemStandard(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  standard: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.standard = standard;
    problem.compiler.args = setStandardArg(problem.compiler.args, standard);
    if (problem.compile) {
      problem.compile.args = setStandardArg(problem.compile.args, standard);
    }
  });
}

export async function updateProblemCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  command: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    setCompilerCommand(problem, command);
  });
}

export async function getProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  return findProblem(problems, problemId);
}

export async function bindProblemStatement(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  statementPath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.statement = {
      path: path.resolve(statementPath),
      type: getStatementType(statementPath),
      sourceType: 'external'
    };
  });
}

export async function unbindProblemStatement(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    delete problem.statement;
  });
}

export async function addProgramToProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sourcePath: string,
  options: { setDefault?: boolean } = {}
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, sourcePath);
    problem.sources = upsertProblemSource(problem.sources ?? [], source);
    if (options.setDefault || !getDefaultProblemSource(problem)) {
      problem.defaultSource = source.path;
      problem.source = source.path;
    }
  });
}

export async function setProblemDefaultSource(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sourcePath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, sourcePath);
    problem.sources = upsertProblemSource(problem.sources ?? [], source);
    problem.defaultSource = source.path;
    problem.source = source.path;
  });
}

export async function deleteProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number
): Promise<{ sample?: SampleConfig; cleanupErrors: string[]; reportCleared: boolean }> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sampleIndex = problem?.samples.findIndex((entry) => entry.id === sampleId) ?? -1;
  if (!problem || sampleIndex < 0) {
    return { cleanupErrors: [], reportCleared: false };
  }

  const [sample] = problem.samples.splice(sampleIndex, 1);
  await writeProblemsConfig(workspaceFolder, problems);

  const cleanupErrors: string[] = [];
  if (inferSampleSourceType(workspaceFolder, sample) === 'managed') {
    await removeManagedSampleFiles(workspaceFolder, sample, cleanupErrors);
  }
  await removeSampleOutputs(workspaceFolder, problemId, sample, cleanupErrors);
  const reportCleared = await updateReportAfterSampleDeleted(workspaceFolder, problemId, sample);

  return { sample, cleanupErrors, reportCleared };
}

export function getDefaultProblemSource(problem: ProblemConfig): string | undefined {
  return problem.defaultSource || problem.source || problem.sources?.[0]?.path;
}

export function getProblemSourcePath(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): string | undefined {
  const source = getDefaultProblemSource(problem);
  return source ? resolveProblemReferencePath(workspaceFolder, source) : undefined;
}

export function resolveProblemReferencePath(workspaceFolder: vscode.WorkspaceFolder, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : resolveWorkspacePath(workspaceFolder, filePath);
}

export async function saveProblemReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  report: unknown
): Promise<void> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function updateProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  update: (problem: ProblemConfig) => void
): Promise<ProblemConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  update(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

async function writeProblemConfig(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): Promise<void> {
  await fs.mkdir(getProblemRoot(workspaceFolder, problem.id), { recursive: true });
  await fs.writeFile(getProblemConfigPath(workspaceFolder, problem.id), `${JSON.stringify(problem, null, 2)}\n`, 'utf8');
}

async function addProblemSampleFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  input: string,
  answer: string
): Promise<SampleConfig> {
  await ensureProblemFolders(workspaceFolder, problem.id);
  const id = nextSampleId(problem);
  const inputRel = toPosixPath(path.join('.oitest', 'problems', problem.id, 'samples', `${id}.in`));
  const answerRel = toPosixPath(path.join('.oitest', 'problems', problem.id, 'samples', `${id}.ans`));
  const outputRel = getProblemSampleOutputPaths(workspaceFolder, problem.id, id).outputRel;

  await fs.writeFile(resolveWorkspacePath(workspaceFolder, inputRel), input, 'utf8');
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, answerRel), answer, 'utf8');

  return {
    id,
    name: `Sample ${id}`,
    input: inputRel,
    answer: answerRel,
    actualOutput: outputRel,
    sourceType: 'managed'
  };
}

async function ensureProblemFolders(workspaceFolder: vscode.WorkspaceFolder, problemId: string): Promise<void> {
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'samples'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'build'), { recursive: true });
}

function normalizeProblem(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): ProblemConfig {
  const defaults = createDefaultConfig();
  const id = problem.id ?? 'problem';
  const defaultSource = problem.defaultSource || problem.source || problem.sources?.[0]?.path;
  const sources = normalizeProblemSources(workspaceFolder, problem, defaultSource);
  return {
    ...defaults,
    ...problem,
    id,
    compiler: problem.compiler ?? problem.compile ?? defaults.compiler,
    compile: problem.compile ?? problem.compiler ?? defaults.compile,
    limits: {
      ...defaults.limits,
      ...problem.limits
    },
    stack: normalizeStackConfig(problem.stack),
    samples: (problem.samples ?? []).map((sample, index) => normalizeProblemSample(workspaceFolder, sample, id, index + 1)),
    standard: problem.standard ?? getStandardFromArgs((problem.compiler ?? defaults.compiler).args),
    source: problem.source,
    defaultSource,
    sources
  };
}

function normalizeProblemSources(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  defaultSource: string | undefined
): ProblemSource[] {
  const sources = [...(problem.sources ?? [])];
  if (defaultSource && !sources.some((source) => source.path === defaultSource)) {
    sources.unshift(createProblemSource(workspaceFolder, defaultSource));
  }
  return sources;
}

function normalizeProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string,
  fallbackId: number
): SampleConfig {
  const id = sample.id ?? fallbackId;
  const outputRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${id}`, 'useroutput.txt'));
  return {
    ...sample,
    id,
    name: sample.name ?? `Sample ${id}`,
    answer: sample.answer ?? sample.expectedOutput ?? toPosixPath(path.join('.oitest', 'problems', problemId, 'samples', `${id}.ans`)),
    actualOutput: sample.actualOutput?.endsWith(`${id}.out`) ? outputRel : (sample.actualOutput ?? outputRel),
    sourceType: sample.sourceType ?? inferSampleSourceType(workspaceFolder, sample)
  };
}

function findProblem(config: ProblemsConfig, problemId: string): ProblemConfig | undefined {
  return config.problems.find((problem) => problem.id === problemId);
}

function createProblemId(baseName: string, config: ProblemsConfig): string {
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'problem';
  let candidate = safeBase;
  let suffix = 2;
  while (config.problems.some((problem) => problem.id === candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createProblemName(baseName: string, config: ProblemsConfig): string {
  let candidate = baseName || 'Problem';
  let suffix = 2;
  while (config.problems.some((problem) => problem.name === candidate)) {
    candidate = `${baseName || 'Problem'} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createProblemSource(workspaceFolder: vscode.WorkspaceFolder, sourcePath: string): ProblemSource {
  const resolved = resolveProblemReferencePath(workspaceFolder, sourcePath);
  const workspaceRelative = path.relative(workspaceFolder.uri.fsPath, resolved);
  const storedPath =
    workspaceRelative && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative)
      ? toPosixPath(workspaceRelative)
      : path.resolve(resolved);
  return {
    path: storedPath,
    name: path.basename(resolved),
    lastUsedAt: new Date().toISOString()
  };
}

function upsertProblemSource(sources: ProblemSource[], source: ProblemSource): ProblemSource[] {
  const filtered = sources.filter((entry) => entry.path !== source.path);
  return [source, ...filtered];
}

function getStatementType(statementPath: string): ProblemStatementType {
  switch (path.extname(statementPath).toLowerCase()) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.pdf':
      return 'pdf';
    case '.txt':
      return 'text';
    default:
      return 'unknown';
  }
}

function nextSampleId(problem: OITestConfig): number {
  return problem.samples.reduce((maxId, sample) => Math.max(maxId, ...sampleNumberCandidates(sample)), 0) + 1;
}

function sampleNumberCandidates(sample: SampleConfig): number[] {
  const values = [
    sample.id,
    parseSampleNumber(sample.name),
    parseSampleNumber(sample.input),
    parseSampleNumber(sample.answer),
    parseSampleNumber(sample.actualOutput ?? '')
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : [0];
}

function parseSampleNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match =
    /\bSample\s+(\d+)\b/iu.exec(value) ??
    /(?:^|[\\/])sample-(\d+)(?:[\\/]|$)/iu.exec(value) ??
    /(?:^|[\\/])(\d+)\.(?:in|ans|out|err|diff)$/iu.exec(value);
  return match ? Number(match[1]) : undefined;
}

async function removeManagedSampleFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  cleanupErrors: string[]
): Promise<void> {
  const oitestRoot = getOITestDir(workspaceFolder);
  for (const samplePath of [sample.input, sample.answer]) {
    const resolved = resolveSamplePath(workspaceFolder, samplePath);
    if (!isUnderPath(resolved, oitestRoot)) {
      continue;
    }
    await removePath(resolved, cleanupErrors);
  }
}

async function removeSampleOutputs(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sample: SampleConfig,
  cleanupErrors: string[]
): Promise<void> {
  const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.id);
  await removePath(path.dirname(paths.outputPath), cleanupErrors);
  await removePath(paths.legacyOutputPath, cleanupErrors);
  await removePath(paths.legacyStderrPath, cleanupErrors);
  await removePath(paths.legacyDiffPath, cleanupErrors);

  if (sample.actualOutput) {
    const resolved = resolveSamplePath(workspaceFolder, sample.actualOutput);
    if (isUnderPath(resolved, path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'))) {
      await removePath(resolved, cleanupErrors);
    }
  }
}

async function updateReportAfterSampleDeleted(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sample: SampleConfig
): Promise<boolean> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  if (!(await exists(reportPath))) {
    return false;
  }

  try {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
    const filter = (entry: { id?: number; name?: string; input?: string; answer?: string }) =>
      entry.id !== sample.id &&
      entry.name !== sample.name &&
      (entry.input !== sample.input || entry.answer !== sample.answer);
    report.samples = (report.samples ?? []).filter(filter);
    report.results = (report.results ?? report.samples).filter(filter);
    report.summary = {
      accepted: report.samples.filter((entry) => entry.status === 'AC').length,
      total: report.samples.length
    };
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return false;
  } catch {
    await fs.rm(reportPath, { force: true });
    return true;
  }
}

async function removePath(targetPath: string, cleanupErrors: string[]): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(`${targetPath}: ${String(error)}`);
  }
}

function formatSampleText(value: string, shouldDecodeEscapes: boolean): string {
  return shouldDecodeEscapes ? value.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : value;
}

function setStandardArg(args: string[], standard: string): string[] {
  const nextArgs = args.filter((arg) => !arg.startsWith('-std='));
  return [`-std=${standard}`, ...nextArgs];
}

function getStandardFromArgs(args: string[]): string {
  return args.find((arg) => arg.startsWith('-std='))?.replace('-std=', '') ?? 'c++17';
}

function guessLegacySource(workspaceFolder: vscode.WorkspaceFolder): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath === workspaceFolder.uri.fsPath) {
    return editor.document.uri.fsPath;
  }
  return undefined;
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
