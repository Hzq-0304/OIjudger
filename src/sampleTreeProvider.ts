import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { exists } from './config';
import { t } from './i18n';
import { explainRuntimeError, renderRuntimeErrorExplanation } from './runtimeErrorExplainer';
import {
  ensureProblemsConfig,
  getDefaultProblemSource,
  getProblemReportPath,
  resolveProblemReferencePath
} from './problems';
import { getSampleFileStatus, inferSampleSourceType } from './sampleFiles';
import { JudgeReport, ProblemConfig, SampleReport, SampleStatus } from './types';

type NodeKind = 'group' | 'problem' | 'info' | 'sample' | 'action';
type NodeGroup =
  | 'problems'
  | 'workspaceActions'
  | 'statement'
  | 'programs'
  | 'limits'
  | 'samples'
  | 'actions'
  | 'sampleActions';

type TreeNode = {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  command?: vscode.Command;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  group?: NodeGroup;
  problemId?: string;
  sampleId?: number;
  sampleStatus?: SampleStatus | 'Not Run';
};

export class SampleTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    item.command = element.command;
    item.contextValue =
      element.kind === 'sample'
        ? element.sampleStatus === 'Missing'
          ? 'sampleMissing'
          : element.sampleStatus === 'WA'
            ? 'sampleWa'
            : 'sample'
        : `oijudger${capitalize(element.kind)}`;
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const config = await ensureProblemsConfig(workspaceFolder);
    if (!element) {
      return createRootNodes();
    }

    if (element.group === 'problems' && !element.problemId) {
      return config.problems.length > 0 ? config.problems.map(createProblemNode) : [createNoProblemsNode()];
    }

    if (element.group === 'workspaceActions') {
      return createWorkspaceActionNodes();
    }

    if (!element.problemId) {
      return [];
    }

    const problem = config.problems.find((entry) => entry.id === element.problemId);
    if (!problem) {
      return [];
    }

    switch (element.group) {
      case undefined:
        return createProblemChildren(workspaceFolder, problem);
      case 'statement':
        return createStatementNodes(workspaceFolder, problem);
      case 'programs':
        return createProgramNodes(workspaceFolder, problem);
      case 'limits':
        return createLimitNodes(problem);
      case 'samples':
        return createSampleNodes(workspaceFolder, problem);
      case 'actions':
        return createProblemActionNodes(problem);
      case 'sampleActions':
        return createSampleActionNodes(element.problemId, element.sampleId, element.sampleStatus);
      default:
        return [];
    }
  }
}

function createRootNodes(): TreeNode[] {
  return [
    {
      kind: 'group',
      label: t('problems'),
      icon: new vscode.ThemeIcon('book'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'problems'
    },
    {
      kind: 'group',
      label: t('workspaceActions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'workspaceActions'
    }
  ];
}

function createProblemNode(problem: ProblemConfig): TreeNode {
  const defaultSource = getDefaultProblemSource(problem);
  return {
    kind: 'problem',
    label: problem.name,
    description: defaultSource ? path.basename(defaultSource) : t('noProgramSet'),
    tooltip: defaultSource ?? t('noProgramSet'),
    icon: new vscode.ThemeIcon('symbol-file'),
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    problemId: problem.id
  };
}

function createNoProblemsNode(): TreeNode {
  return {
    kind: 'info',
    label: t('noProblems'),
    description: t('addProblemFromCurrentFile'),
    icon: new vscode.ThemeIcon('circle-slash'),
    command: {
      command: 'oijudger.addProblemFromCurrentFile',
      title: t('addProblemFromCurrentFile')
    }
  };
}

function createProblemChildren(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode[] {
  return [
    {
      kind: 'group',
      label: t('statement'),
      icon: new vscode.ThemeIcon('book'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'statement',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('programs'),
      icon: new vscode.ThemeIcon('file-code'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'programs',
      problemId: problem.id
    },
    infoNode(t('defaultProgramLine', { program: getDefaultProblemSource(problem) ? path.basename(getDefaultProblemSource(problem) ?? '') : t('noProgramSet') }), 'file-code'),
    infoNode(t('compilerLine', { compiler: path.basename(problem.compiler.command || 'g++') }), 'terminal'),
    infoNode(t('standardLine', { standard: problem.standard }), 'settings'),
    createCheckerInfoNode(workspaceFolder, problem),
    {
      kind: 'group',
      label: t('limits'),
      icon: new vscode.ThemeIcon('dashboard'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'limits',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('samples'),
      icon: new vscode.ThemeIcon('list-tree'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'samples',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('actions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'actions',
      problemId: problem.id
    }
  ];
}

function createLimitNodes(problem: ProblemConfig): TreeNode[] {
  return [
    actionNode(`${t('time')}: ${problem.limits.timeMs} ms`, 'oijudger.setProblemTimeLimit', 'watch', problem.id),
    actionNode(`${t('memory')}: ${problem.limits.memoryMb} MB`, 'oijudger.setProblemMemoryLimit', 'server', problem.id),
    actionNode(`${t('stack')}: ${formatStackLabel(problem)}`, 'oijudger.setStackSize', 'layers', problem.id)
  ];
}

async function createStatementNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  if (!problem.statement) {
    return [
      actionNode(`${t('statement')}: ${t('noStatementBound')}`, 'oijudger.bindStatement', 'link', problem.id)
    ];
  }

  const statementPath = resolveProblemReferencePath(workspaceFolder, problem.statement.path);
  const missing = !(await exists(statementPath));
  return [
    {
      kind: 'info',
      label: missing ? `${t('statement')}: ${t('statusMissing')}` : `${t('statement')}: ${path.basename(statementPath)}`,
      tooltip: statementPath,
      icon: missing
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon(statementIcon(problem.statement.type)),
      command: {
        command: 'oijudger.openStatement',
        title: t('openStatement'),
        arguments: [problem.id]
      }
    }
  ];
}

async function createProgramNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  const sources = problem.sources ?? [];
  if (sources.length === 0) {
    return [
      actionNode(`${t('programs')}: ${t('noPrograms')}`, 'oijudger.addProgramToProblem', 'file-add', problem.id)
    ];
  }

  const defaultSource = getDefaultProblemSource(problem);
  return Promise.all(sources.map(async (source) => {
    const sourcePath = resolveProblemReferencePath(workspaceFolder, source.path);
    const missing = !(await exists(sourcePath));
    return {
      kind: 'info',
      label: source.name ?? path.basename(sourcePath),
      description: missing ? t('statusMissing') : (source.path === defaultSource ? t('defaultProgram') : undefined),
      tooltip: sourcePath,
      icon: missing
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon('file-code')
    };
  }));
}

async function createSampleNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  if (problem.samples.length === 0) {
    return [
      {
        kind: 'info',
        label: t('noSamplesTree'),
        description: t('addSample'),
        icon: new vscode.ThemeIcon('beaker-stop'),
        command: {
          command: 'oijudger.addProblemSample',
          title: t('addSample'),
          arguments: [problem.id]
        }
      }
    ];
  }

  const report = await readReport(workspaceFolder, problem.id);
  return Promise.all(problem.samples.map(async (sample) => {
    const sampleReport = report?.samples.find((entry) =>
      entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
    );
    const fileStatus = await getSampleFileStatus(workspaceFolder, sample);
    const missing = fileStatus.inputMissing || fileStatus.answerMissing;
    const status = missing ? 'Missing' : (sampleReport?.status ?? 'Not Run');
    const elapsed = sampleReport && !missing ? formatElapsed(sampleReport) : '';
    const description = formatSampleDescription(status, sampleReport, elapsed);
    const sourceType = inferSampleSourceType(workspaceFolder, sample);
    const missingDetail = fileStatus.missingPaths.length > 0
      ? `\n${t(sourceType === 'external' ? 'externalSampleMissing' : 'sampleMissing')}:\n${fileStatus.missingPaths.join('\n')}`
      : '';
    return {
      kind: 'sample',
      label: sample.name,
      description,
      tooltip: [
        `${t('sampleName')}: ${sample.name}`,
        `${t('internalId')}: ${sample.id}`,
        `${t('sampleInput')}: ${fileStatus.inputPath}`,
        `${t('expectedOutput')}: ${fileStatus.answerPath}`,
        `${t('source')}: ${t(sourceType === 'external' ? 'externalSample' : 'managedSample')}${missingDetail}`,
        ...(sampleReport?.status === 'Scored' ? [
          `${t('status')}: ${t('statusScored')}`,
          `${t('checkerScore')}: ${sampleReport.checker?.scoreText ?? sampleReport.score ?? ''}`,
          `${t('checker')}: ${t('plainCheckerMode')}`,
          t('plainCheckerProtocol')
        ] : []),
        ...(sampleReport?.checker?.message ? [`${t('checker')}: ${sampleReport.checker.message}`] : []),
        ...(sampleReport?.checker?.stdout ? [`${t('checkerOutput')}: ${sampleReport.checker.stdout}`] : []),
        ...(sampleReport?.checker?.stderr ? [`${t('checkerStderr')}: ${sampleReport.checker.stderr}`] : []),
        ...createRuntimeTooltipLines(sampleReport)
      ].join('\n'),
      icon: status === 'Missing'
        ? new vscode.ThemeIcon(statusIcon(status), new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon(statusIcon(status)),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'sampleActions',
      problemId: problem.id,
      sampleId: sample.index,
      sampleStatus: status
    };
  }));
}

function createRuntimeTooltipLines(report: SampleReport | undefined): string[] {
  if (!report || report.status !== 'RE') {
    return [];
  }

  const explanation = getRuntimeExplanation(report);
  const lines = explanation
    ? ['', renderRuntimeErrorExplanation(explanation, { stderrEmpty: report.stderrPreview === '' })]
    : ['', `Runtime Error: ${t('unknownRuntimeError')}`];
  if (report.stdinError) {
    lines.push(`stdinError: ${report.stdinError}`);
  }
  if (report.stdoutError) {
    lines.push(`stdoutError: ${report.stdoutError}`);
  }
  if (report.stderrError) {
    lines.push(`stderrError: ${report.stderrError}`);
  }
  if (report.stderrPreview !== undefined) {
    lines.push(report.stderrPreview.trim() ? `stderr: ${report.stderrPreview}` : 'stderr is empty.');
  }
  if (
    report.exitCode === undefined &&
    report.signal === undefined &&
    !report.spawnError &&
    !report.runnerError
  ) {
    lines.push('Runtime Error: missing diagnostic information. This is an OIjudger internal issue. See Output Channel.');
  }
  return lines;
}

function formatSampleDescription(
  status: SampleStatus | 'Not Run',
  report: SampleReport | undefined,
  elapsed: string
): string {
  const explanation = report?.status === 'RE' ? getRuntimeExplanation(report) : undefined;
  if (status === 'Scored' && report?.checker?.scoreText !== undefined) {
    return report.checker.scoreText;
  }
  const statusText = explanation ? `RE: ${explanation.englishName}` : statusLabel(status);
  return elapsed ? `${statusText}  ${elapsed}` : statusText;
}

function getRuntimeExplanation(report: SampleReport) {
  return explainRuntimeError({
    exitCode: report.runtimeError?.rawExitCode ?? report.exitCode,
    signal: report.runtimeError?.rawSignal ?? report.signal,
    spawnError: report.spawnError,
    runnerError: report.runnerError,
    platform: process.platform
  });
}

function createSampleActionNodes(
  problemId: string,
  sampleId: number | undefined,
  status: SampleStatus | 'Not Run' | undefined
): TreeNode[] {
  if (sampleId === undefined) {
    return [];
  }

  const nodes = [
    sampleActionNode(t('openSampleInput'), 'oijudger.openSampleInput', 'go-to-file', problemId, sampleId),
    sampleActionNode(t('openExpectedOutput'), 'oijudger.openSampleAnswer', 'go-to-file', problemId, sampleId)
  ];

  if (status !== 'Missing') {
    nodes.push(sampleActionNode(t('openUserOutput'), 'oijudger.openSampleUserOutput', 'output', problemId, sampleId));
    nodes.push(sampleActionNode(t('openStderr'), 'oijudger.openSampleStderr', 'warning', problemId, sampleId));
  }

  if (status === 'WA') {
    nodes.push(sampleActionNode(t('openDiff'), 'oijudger.openSampleDiff', 'diff', problemId, sampleId));
  }
  if (status === 'WA' || status === 'AC' || status === 'Scored' || status === 'Checker Error') {
    nodes.push(sampleActionNode(t('checkerOutput'), 'oijudger.openCheckerOutput', 'output', problemId, sampleId));
    nodes.push(sampleActionNode(t('checkerStderr'), 'oijudger.openCheckerStderr', 'warning', problemId, sampleId));
  }

  return nodes;
}

function createProblemActionNodes(problem: ProblemConfig): TreeNode[] {
  return [
    actionNode(t('setChecker'), 'oijudger.setChecker', 'verified', problem.id),
    actionNode(t('clearChecker'), 'oijudger.clearChecker', 'clear-all', problem.id),
    actionNode(t('openChecker'), 'oijudger.openChecker', 'go-to-file', problem.id),
    actionNode(t('importTestlib'), 'oijudger.importTestlib', 'cloud-download', problem.id),
    actionNode(t('openTestlib'), 'oijudger.openTestlib', 'book', problem.id),
    actionNode(t('bindStatement'), 'oijudger.bindStatement', 'link', problem.id),
    actionNode(t('openStatement'), 'oijudger.openStatement', 'book', problem.id),
    actionNode(t('unbindStatement'), 'oijudger.unbindStatement', 'debug-disconnect', problem.id),
    actionNode(t('addProgram'), 'oijudger.addProgramToProblem', 'file-add', problem.id),
    actionNode(t('setDefaultProgram'), 'oijudger.setDefaultProgram', 'star-full', problem.id),
    actionNode(t('runDefaultProgram'), 'oijudger.runProblemSamples', 'run-all', problem.id),
    actionNode(t('runWithProgram'), 'oijudger.runSamplesWithProgram', 'run', problem.id),
    actionNode(t('addSample'), 'oijudger.addProblemSample', 'add', problem.id),
    actionNode(t('addSampleFromFiles'), 'oijudger.addProblemSampleFromFiles', 'file-add', problem.id),
    actionNode(t('batchAddSamples'), 'oijudger.batchAddSamples', 'folder-opened', problem.id),
    actionNode(t('setTimeLimit'), 'oijudger.setProblemTimeLimit', 'watch', problem.id),
    actionNode(t('setMemoryLimit'), 'oijudger.setProblemMemoryLimit', 'server', problem.id),
    actionNode(t('setStackSize'), 'oijudger.setStackSize', 'layers', problem.id),
    actionNode(t('setCppStandard'), 'oijudger.setProblemStandard', 'settings', problem.id),
    actionNode(t('selectCompiler'), 'oijudger.selectProblemCompiler', 'settings-gear', problem.id),
    actionNode(t('openResultPanel'), 'oijudger.openProblemResultPanel', 'layout-panel', problem.id)
  ];
}

function createCheckerInfoNode(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode {
  const checker = problem.checker;
  if (!checker?.enabled || checker.type === 'none') {
    return infoNode(`${t('checker')}: ${t('normalCompare')}`, 'check');
  }

  const checkerPath = checker.source
    ? resolveProblemReferencePath(workspaceFolder, checker.source)
    : undefined;
  const missing = !checkerPath || !existsSync(checkerPath);
  return {
    kind: 'info',
    label: missing
      ? `${t('checker')}: ${t('statusMissing')}`
      : `${t('checker')}: testlib ${path.basename(checkerPath)}`,
    tooltip: checkerPath ?? t('checkerMissing'),
    icon: missing
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon('verified')
  };
}

function createWorkspaceActionNodes(): TreeNode[] {
  return [
    actionNode(t('createProblem'), 'oijudger.createProblem', 'new-folder'),
    actionNode(t('addProblemFromCurrentFile'), 'oijudger.addProblemFromCurrentFile', 'file-code'),
    actionNode(t('addProblemFromFile'), 'oijudger.addProblemFromFile', 'file-add'),
    actionNode(t('refreshView'), 'oijudger.refreshView', 'refresh'),
    actionNode(t('importLegacyProblem'), 'oijudger.importLegacyProblem', 'repo-pull')
  ];
}

function infoNode(label: string, icon: string): TreeNode {
  return {
    kind: 'info',
    label,
    icon: new vscode.ThemeIcon(icon)
  };
}

function actionNode(label: string, command: string, icon: string, problemId?: string): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    command: {
      command,
      title: label,
      arguments: problemId ? [problemId] : []
    }
  };
}

function sampleActionNode(
  label: string,
  command: string,
  icon: string,
  problemId: string,
  sampleId: number
): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    sampleId,
    command: {
      command,
      title: label,
      arguments: [problemId, sampleId]
    }
  };
}

async function readReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<JudgeReport | undefined> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
  } catch {
    return undefined;
  }
}

function formatElapsed(report: SampleReport): string {
  const timeMs = report.timeMs ?? report.elapsedMs;
  if (report.status === 'TLE') {
    return `>${formatMs(timeMs)}ms`;
  }
  return `${formatMs(timeMs)}ms`;
}

function formatStackLabel(problem: ProblemConfig): string {
  const stack = problem.stack ?? { auto: true, sizeMb: null };
  if (!stack.auto) {
    return t('stackDisabled');
  }
  if (stack.sizeMb) {
    return `${stack.sizeMb} MB`;
  }
  return `${t('stackFollowMemory')} ${problem.limits.memoryMb} MB`;
}

function formatMs(value: number): number {
  return Math.round(value);
}

function statusIcon(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return 'pass-filled';
    case 'WA':
    case 'Missing':
      return 'error';
    case 'Scored':
      return 'question';
    case 'TLE':
    case 'MLE':
      return 'watch';
    case 'RE':
    case 'CE':
    case 'Checker Error':
    case 'Skipped':
    case 'ERR':
      return 'warning';
    case 'Not Run':
      return 'circle-outline';
  }
}

function statusLabel(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return t('statusAC');
    case 'WA':
      return t('statusWA');
    case 'TLE':
      return t('statusTLE');
    case 'RE':
      return t('statusRE');
    case 'CE':
      return t('statusCE');
    case 'Scored':
      return t('statusScored');
    case 'Checker Error':
      return t('checkerError');
    case 'MLE':
      return t('statusMLE');
    case 'Skipped':
      return t('statusSkipped');
    case 'Missing':
      return t('statusMissing');
    case 'ERR':
      return t('statusERR');
    case 'Not Run':
      return t('notRun');
  }
}

function statementIcon(type: string): string {
  switch (type) {
    case 'markdown':
      return 'markdown';
    case 'pdf':
      return 'file-pdf';
    case 'text':
      return 'file-text';
    default:
      return 'file';
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
