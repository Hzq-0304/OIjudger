import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import {
  ensureConfig,
  exists,
  getReportPath,
  getWorkspaceFolder,
  resolveWorkspacePath
} from './config';
import { t } from './i18n';
import { getDefaultProblemSource, getProblem, getProblemReportPath } from './problems';
import { explainRuntimeError, renderRuntimeErrorExplanation } from './runtimeErrorExplainer';
import { inferSampleSourceType } from './sampleFiles';
import { JudgeReport, ProblemConfig, SampleConfig, SampleReport } from './types';

const openProblemReportPanels = new Map<string, {
  panel: vscode.WebviewPanel;
  workspaceFolder: vscode.WorkspaceFolder;
}>();

export async function openLastReport(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const report = await readReport(workspaceFolder);
  if (!report) {
    vscode.window.showWarningMessage(t('noReport'));
    return;
  }

  await showReportPanel(context, workspaceFolder, report);
}

export async function openSampleDetail(context: vscode.ExtensionContext, sampleId?: number): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const config = await ensureConfig(workspaceFolder);
  const report = await readReport(workspaceFolder);
  const sample = config.samples.find((entry) => entry.index === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  await showSamplePanel(context, workspaceFolder, sample, report?.samples.find((entry) =>
    entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
  ));
}

export async function openProblemReport(context: vscode.ExtensionContext, problemId: string): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const report = await readReportFile(getProblemReportPath(workspaceFolder, problemId));
  if (!report) {
    vscode.window.showWarningMessage(t('noReport'));
    return;
  }

  const problem = await getProblem(workspaceFolder, problemId);
  await showReportPanel(context, workspaceFolder, report, problemId, problem);
}

export async function refreshProblemReportPanel(problemId: string): Promise<void> {
  const entry = openProblemReportPanels.get(problemId);
  if (!entry) {
    return;
  }

  const report = await readReportFile(getProblemReportPath(entry.workspaceFolder, problemId));
  entry.panel.webview.html = renderPage(
    t('reportTitle'),
    report
      ? renderReportBody(entry.workspaceFolder, report, problemId, await getProblem(entry.workspaceFolder, problemId))
      : `<section><p>${escapeHtml(t('noReport'))}</p></section>`
  );
}

export async function openProblemSampleDetail(
  context: vscode.ExtensionContext,
  problemId: string,
  sampleId: number
): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  const report = await readReportFile(getProblemReportPath(workspaceFolder, problemId));
  const sample = problem.samples.find((entry) => entry.index === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  await showSamplePanel(context, workspaceFolder, sample, report?.samples.find((entry) =>
    entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
  ), problemId);
}

async function readReport(workspaceFolder: vscode.WorkspaceFolder): Promise<JudgeReport | undefined> {
  const reportPath = getReportPath(workspaceFolder);
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return readReportFile(reportPath);
  } catch {
    return undefined;
  }
}

async function readReportFile(reportPath: string): Promise<JudgeReport | undefined> {
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
  } catch {
    return undefined;
  }
}

async function showReportPanel(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  problemId?: string,
  problem?: ProblemConfig
): Promise<void> {
  const title = t('reportTitle');
  const panel = createPanel(context, title, problemId);
  if (problemId) {
    openProblemReportPanels.set(problemId, { panel, workspaceFolder });
    panel.onDidDispose(() => openProblemReportPanels.delete(problemId));
  }
  panel.webview.html = renderPage(title, renderReportBody(workspaceFolder, report, problemId, problem));
}

function renderReportBody(
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  problemId?: string,
  problem?: ProblemConfig
): string {
  return `<section class="summary">
      <div><span>${escapeHtml(t('problem'))}</span><strong>${escapeHtml(problem?.name ?? '-')}</strong></div>
      <div><span>${escapeHtml(t('statement'))}</span><strong>${escapeHtml(problem?.statement ? basename(problem.statement.path) : t('noStatementBound'))}</strong></div>
      <div><span>${escapeHtml(t('program'))}</span><strong>${escapeHtml(report.sourceName ?? basename(report.source || (problem ? getDefaultProblemSource(problem) : '') || ''))}</strong></div>
      <div><span>${escapeHtml(t('judgeMode'))}</span><strong>${escapeHtml(formatJudgeMode(report))}</strong></div>
      ${isCheckerReport(report) ? `<div><span>${escapeHtml(t('checker'))}</span><strong>${escapeHtml(formatCheckerLine(report))}</strong></div>` : ''}
      <div><span>${escapeHtml(t('accepted'))}</span><strong>${report.summary.accepted}/${report.summary.total}</strong></div>
      ${report.summary.wrongAnswer !== undefined ? `<div><span>${escapeHtml(t('statusWA'))}</span><strong>${report.summary.wrongAnswer}</strong></div>` : ''}
      ${report.summary.scored ? `<div><span>${escapeHtml(t('scoredSamples'))}</span><strong>${report.summary.scored}</strong></div>` : ''}
      ${report.summary.checkerError ? `<div><span>${escapeHtml(t('checkerError'))}</span><strong>${report.summary.checkerError}</strong></div>` : ''}
      ${report.score ? `<div><span>${escapeHtml(t('score'))}</span><strong>${report.score.earned}/${report.score.total}</strong></div>` : ''}
      ${report.summary.scored && report.score ? `<div><span>${escapeHtml(t('checkerTotalScore'))}</span><strong>${report.score.earned}</strong></div>` : ''}
      <div><span>${escapeHtml(t('compile'))}</span><strong>${formatDuration(report.compile?.timeMs)}</strong></div>
      <div><span>${escapeHtml(t('total'))}</span><strong>${formatDuration(report.totalTimeMs)}</strong></div>
      <div><span>${escapeHtml(t('timeLimit'))}</span><strong>${report.timeLimitMs} ms</strong></div>
      <div><span>${escapeHtml(t('memoryLimit'))}</span><strong>${report.memoryLimitMb} MB</strong></div>
      <div><span>${escapeHtml(t('stack'))}</span><strong>${escapeHtml(formatStack(report))}</strong></div>
      <div><span>${escapeHtml(t('generated'))}</span><strong>${escapeHtml(new Date(report.generatedAt).toLocaleString())}</strong></div>
    </section>
    ${getReportCheckerType(report) === 'plain' ? `<section><h2>${escapeHtml(t('plainCheckerMode'))}</h2><p>${escapeHtml(t('plainCheckerProtocol'))}</p></section>` : ''}
    <section>
      <h2>${escapeHtml(t('source'))}</h2>
      <p class="path">${escapeHtml(report.source)}</p>
    </section>
    <section>
      <h2>${escapeHtml(t('samples'))}</h2>
      <div class="samples">
        ${report.samples.map((sample) => renderSampleCard(workspaceFolder, report, sample, problemId)).join('')}
      </div>
    </section>`;
}

function formatStack(report: JudgeReport): string {
  const stack = report.compile?.stack;
  if (!stack || !stack.enabled) {
    return t('stackDisabled');
  }
  return stack.sizeMb ? `${stack.sizeMb} MB` : '';
}

function formatJudgeMode(report: JudgeReport): string {
  if (isCheckerReport(report)) {
    return t('customChecker');
  }
  return t('normalTextCompare');
}

function basename(filePath: string): string {
  return filePath.replace(/^.*[\\/]/u, '');
}

async function showSamplePanel(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  report: SampleReport | undefined,
  problemId?: string
): Promise<void> {
  const status = report?.status ?? 'Not Run';
  const elapsed = report ? `${formatMs(report.timeMs ?? report.elapsedMs)} ms` : '-';
  const compareElapsed = report?.compareTimeMs !== undefined ? `${formatMs(report.compareTimeMs)} ms` : '-';
  const sourceType = inferSampleSourceType(workspaceFolder, sample);
  const title = t('sampleDetail', { sample: sample.name });
  const panel = createPanel(context, title, problemId);
  panel.webview.html = renderPage(
    title,
    `<section class="summary">
      <div><span>${escapeHtml(t('status'))}</span><strong class="status ${statusClass(status)}">${escapeHtml(statusLabel(status))}</strong></div>
      <div><span>${escapeHtml(t('elapsed'))}</span><strong>${escapeHtml(elapsed)}</strong></div>
      <div><span>${escapeHtml(t('compareTime'))}</span><strong>${escapeHtml(compareElapsed)}</strong></div>
      <div><span>${escapeHtml(t('source'))}</span><strong>${escapeHtml(t(sourceType === 'external' ? 'externalSample' : 'managedSample'))}</strong></div>
      ${report?.status === 'Scored' ? `<div><span>${escapeHtml(t('checkerScore'))}</span><strong>${escapeHtml(report.checker?.scoreText ?? String(report.score ?? ''))}</strong></div>` : ''}
      <div><span>${escapeHtml(t('input'))}</span><strong>${escapeHtml(sample.input)}</strong></div>
      <div><span>${escapeHtml(t('answer'))}</span><strong>${escapeHtml(sample.answer)}</strong></div>
    </section>
    ${report ? renderRuntimeErrorDetails(report) : ''}
    ${report ? renderCheckerErrorDetails(report) : ''}
    ${report?.message ? `<section><h2>${escapeHtml(t('message'))}</h2><p>${escapeHtml(report.message)}</p></section>` : ''}
    <section>
      <h2>${escapeHtml(t('actions'))}</h2>
      ${renderActionButtons(sample.index, problemId, status, Boolean(report?.checker?.output || report?.checker?.stdout || report?.checker?.stderr))}
    </section>`
  );
}

function createPanel(context: vscode.ExtensionContext, title: string, problemId?: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'oijudgerReport',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [context.extensionUri]
    }
  );
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!problemId || typeof message !== 'object' || message === null) {
      return;
    }
    const typed = message as { command?: unknown; sampleId?: unknown };
    if (typeof typed.command !== 'string' || typeof typed.sampleId !== 'number') {
      return;
    }

    const commandMap: Record<string, string> = {
      input: 'oijudger.openSampleInput',
      expected: 'oijudger.openSampleAnswer',
      output: 'oijudger.openSampleUserOutput',
      diff: 'oijudger.openSampleDiff',
      checkerOutput: 'oijudger.openCheckerOutput',
      delete: 'oijudger.deleteSample'
    };
    const command = commandMap[typed.command];
    if (command) {
      await vscode.commands.executeCommand(command, problemId, typed.sampleId);
    }
  });
  return panel;
}

function renderSampleCard(
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  sample: SampleReport,
  problemId?: string
): string {
  const outputPath = resolveWorkspacePath(workspaceFolder, sample.output ?? sample.actualOutput);
  const sourceType = sample.sampleSourceType ?? 'managed';
  const sampleIndex = getReportSampleIndex(sample);
  return `<article class="sample">
    <div class="sampleHead">
      <strong>${escapeHtml(sample.name)}</strong>
      <span class="status ${statusClass(sample.status)}">${escapeHtml(statusLabel(sample.status))}</span>
    </div>
    <dl>
      <dt>${escapeHtml(t('elapsed'))}</dt><dd>${formatDuration(sample.timeMs ?? sample.elapsedMs)}</dd>
      <dt>${escapeHtml(t('compareTime'))}</dt><dd>${formatDuration(sample.compareTimeMs)}</dd>
      <dt>${escapeHtml(t('source'))}</dt><dd>${escapeHtml(t(sourceType === 'external' ? 'externalSample' : 'managedSample'))}</dd>
      ${sample.status === 'Scored' ? `<dt>${escapeHtml(t('checkerScore'))}</dt><dd>${escapeHtml(sample.checker?.scoreText ?? String(sample.score ?? ''))}</dd>` : ''}
      ${sample.score !== undefined ? `<dt>${escapeHtml(t('score'))}</dt><dd>${sample.score}</dd>` : ''}
      ${sample.checker?.message ? `<dt>${escapeHtml(t('checker'))}</dt><dd>${escapeHtml(sample.checker.message)}</dd>` : ''}
      <dt>${escapeHtml(t('input'))}</dt><dd>${escapeHtml(sample.input)}</dd>
      <dt>${escapeHtml(t('answer'))}</dt><dd>${escapeHtml(sample.answer)}</dd>
      <dt>${escapeHtml(t('userOutput'))}</dt><dd>${escapeHtml(sample.output ?? sample.actualOutput)}</dd>
    </dl>
    ${sample.message ? `<p>${escapeHtml(sample.message)}</p>` : ''}
    ${renderRuntimeErrorDetails(sample)}
    ${renderCheckerErrorDetails(sample)}
    <p class="path">${escapeHtml(outputPath)}</p>
    ${renderActionButtons(sampleIndex, problemId, sample.status, isCheckerReport(report) && Boolean(sample.checker?.output || sample.checker?.stdout || sample.checker?.stderr))}
  </article>`;
}

function renderRuntimeErrorDetails(sample: SampleReport): string {
  if (sample.status !== 'RE') {
    return '';
  }

  const explanation = explainRuntimeError({
    exitCode: sample.runtimeError?.rawExitCode ?? sample.exitCode,
    signal: sample.runtimeError?.rawSignal ?? sample.signal,
    spawnError: sample.spawnError,
    runnerError: sample.runnerError,
    platform: process.platform
  });
  if (!explanation) {
    return '';
  }

  return `<section class="runtimeError">
    <h2>${escapeHtml(t('runtimeErrorDetails'))}</h2>
    <pre>${escapeHtml(renderRuntimeErrorExplanation(explanation, { stderrEmpty: sample.stderrPreview === '' }))}</pre>
  </section>`;
}

function renderCheckerErrorDetails(sample: SampleReport): string {
  if (sample.status !== 'Checker Error' || !sample.checker?.errorName) {
    return '';
  }

  const checker = sample.checker;
  const errorName = checker.errorName ?? 'Checker Error';
  const exitCode = checker.exitCode !== undefined && checker.exitCode !== null
    ? `<p><strong>${escapeHtml(t('exitCode'))}:</strong> ${checker.exitCode}${checker.exitCodeHex ? ` (${escapeHtml(checker.exitCodeHex)})` : ''}</p>`
    : '';
  return `<section class="runtimeError">
    <h2>${escapeHtml(t('checkerError'))}: ${escapeHtml(errorName)}</h2>
    ${exitCode}
    ${checker.message ? `<pre>${escapeHtml(checker.message)}</pre>` : ''}
  </section>`;
}

function renderActionButtons(
  sampleId: number | undefined,
  problemId: string | undefined,
  status: string,
  hasCheckerOutput: boolean
): string {
  const disabled = problemId && sampleId !== undefined ? '' : ' disabled';
  const diffDisabled = status === 'WA' ? disabled : ' disabled';
  const sampleValue = sampleId ?? '';
  return `<div class="buttons">
    <button data-command="input" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('input'))}</button>
    <button data-command="expected" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('expectedOutput'))}</button>
    <button data-command="output" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('runResult'))}</button>
    <button data-command="diff" data-sample="${sampleValue}"${diffDisabled}>${escapeHtml(t('openDiff'))}</button>
    ${hasCheckerOutput ? `<button data-command="checkerOutput" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('checkerOutput'))}</button>` : ''}
    <button data-command="delete" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('delete'))}</button>
  </div>`;
}

function isCheckerReport(report: JudgeReport): boolean {
  return report.judgeMode === 'checker' || report.judgeMode === 'testlib' || report.judgeMode === 'plain';
}

function getReportCheckerType(report: JudgeReport): 'testlib' | 'plain' | undefined {
  if (report.checkerType === 'testlib' || report.checkerType === 'plain') {
    return report.checkerType;
  }
  if (report.judgeMode === 'testlib' || report.judgeMode === 'plain') {
    return report.judgeMode;
  }
  return report.checker?.type === 'testlib' || report.checker?.type === 'plain' ? report.checker.type : undefined;
}

function formatCheckerLine(report: JudgeReport): string {
  const type = getReportCheckerType(report);
  const typeLabel = type === 'plain' ? t('plainCheckerMode') : type === 'testlib' ? t('testlibCheckerMode') : t('checkerNotSet');
  return report.checker?.source ? `${typeLabel}: ${basename(report.checker.source)}` : typeLabel;
}

function getReportSampleIndex(sample: SampleReport): number | undefined {
  if (typeof sample.index === 'number' && Number.isFinite(sample.index) && sample.index > 0) {
    return sample.index;
  }

  const rawId = (sample as { id?: unknown }).id;
  if (typeof rawId === 'number' && Number.isFinite(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === 'string') {
    const idMatch = /^sample-(\d+)$/iu.exec(rawId);
    if (idMatch) {
      return Number(idMatch[1]);
    }
  }

  const nameMatch = /\bSample\s+(\d+)\b/iu.exec(sample.name);
  return nameMatch ? Number(nameMatch[1]) : undefined;
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 20px;
    }
    h1 { font-size: 22px; margin: 0 0 18px; }
    h2 { font-size: 14px; margin: 0 0 10px; }
    section { margin-bottom: 20px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }
    .summary div,
    .sample {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-sideBar-background);
    }
    .summary span,
    dt {
      color: var(--vscode-descriptionForeground);
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .summary strong { font-size: 16px; }
    .samples {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .sampleHead {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    dl {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 4px 8px;
      margin: 0;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    button {
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      padding: 4px 10px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .status { font-weight: 700; }
    .status-ac { color: var(--vscode-testing-iconPassed); }
    .status-wa,
    .status-tle,
    .status-re,
    .status-err,
    .status-missing { color: var(--vscode-testing-iconFailed); }
    .status-not-run { color: var(--vscode-descriptionForeground); }
    .path {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      overflow-x: auto;
      padding: 10px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-command][data-sample]');
      if (!button || button.disabled) {
        return;
      }
      vscode.postMessage({
        command: button.dataset.command,
        sampleId: Number(button.dataset.sample)
      });
    });
  </script>
</body>
</html>`;
}

function statusClass(status: string): string {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function formatMs(value: number | undefined): number | string {
  return value === undefined ? '-' : Math.round(value);
}

function formatDuration(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value)} ms`;
}

function statusLabel(status: string): string {
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
    case 'MLE':
      return t('statusMLE');
    case 'ERR':
      return t('statusERR');
    case 'Checker Error':
      return t('checkerError');
    case 'Scored':
      return t('statusScored');
    case 'Skipped':
      return t('statusSkipped');
    case 'Missing':
      return t('statusMissing');
    case 'Not Run':
      return t('notRun');
    default:
      return status;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
