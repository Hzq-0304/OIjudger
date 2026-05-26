import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import {
  ensureConfig,
  exists,
  getReportPath,
  getWorkspaceFolder,
  resolveWorkspacePath
} from './config';
import { JudgeReport, SampleConfig, SampleReport } from './types';

export async function openLastReport(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const report = await readReport(workspaceFolder);
  if (!report) {
    vscode.window.showWarningMessage('No OIjudger report found. Run all samples first.');
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
  const sample = config.samples.find((entry) => entry.id === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage('Sample not found.');
    return;
  }

  await showSamplePanel(context, workspaceFolder, sample, report?.samples.find((entry) => entry.id === sample.id));
}

async function readReport(workspaceFolder: vscode.WorkspaceFolder): Promise<JudgeReport | undefined> {
  const reportPath = getReportPath(workspaceFolder);
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
  report: JudgeReport
): Promise<void> {
  const panel = createPanel(context, 'OIjudger Report');
  panel.webview.html = renderPage(
    'OIjudger Report',
    `<section class="summary">
      <div><span>Accepted</span><strong>${report.summary.accepted}/${report.summary.total}</strong></div>
      <div><span>Time Limit</span><strong>${report.timeLimitMs} ms</strong></div>
      <div><span>Memory Limit</span><strong>${report.memoryLimitMb} MB</strong></div>
      <div><span>Generated</span><strong>${escapeHtml(new Date(report.generatedAt).toLocaleString())}</strong></div>
    </section>
    <section>
      <h2>Source</h2>
      <p class="path">${escapeHtml(report.source)}</p>
    </section>
    <section>
      <h2>Samples</h2>
      <div class="samples">
        ${report.samples.map((sample) => renderSampleCard(workspaceFolder, sample)).join('')}
      </div>
    </section>`
  );
}

async function showSamplePanel(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  report: SampleReport | undefined
): Promise<void> {
  const input = await readText(resolveWorkspacePath(workspaceFolder, sample.input));
  const answer = await readText(resolveWorkspacePath(workspaceFolder, sample.answer));
  const actualOutput = report?.actualOutput
    ? await readText(resolveWorkspacePath(workspaceFolder, report.actualOutput))
    : 'Not run yet.';

  const status = report?.status ?? 'Not Run';
  const elapsed = report ? `${report.elapsedMs} ms` : '-';
  const panel = createPanel(context, `${sample.name} Detail`);
  panel.webview.html = renderPage(
    `${sample.name} Detail`,
    `<section class="summary">
      <div><span>Status</span><strong class="status ${statusClass(status)}">${escapeHtml(status)}</strong></div>
      <div><span>Elapsed</span><strong>${escapeHtml(elapsed)}</strong></div>
      <div><span>Input</span><strong>${escapeHtml(sample.input)}</strong></div>
      <div><span>Answer</span><strong>${escapeHtml(sample.answer)}</strong></div>
    </section>
    ${report?.message ? `<section><h2>Message</h2><p>${escapeHtml(report.message)}</p></section>` : ''}
    <section class="columns">
      ${renderBlock('Input', input)}
      ${renderBlock('Expected Output', answer)}
      ${renderBlock('User Output', actualOutput)}
    </section>`
  );
}

function createPanel(context: vscode.ExtensionContext, title: string): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(
    'oijudgerReport',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [context.extensionUri]
    }
  );
}

function renderSampleCard(workspaceFolder: vscode.WorkspaceFolder, sample: SampleReport): string {
  const actualPath = resolveWorkspacePath(workspaceFolder, sample.actualOutput);
  return `<article class="sample">
    <div class="sampleHead">
      <strong>${escapeHtml(sample.name)}</strong>
      <span class="status ${statusClass(sample.status)}">${escapeHtml(sample.status)}</span>
    </div>
    <dl>
      <dt>Elapsed</dt><dd>${sample.elapsedMs} ms</dd>
      <dt>Input</dt><dd>${escapeHtml(sample.input)}</dd>
      <dt>Answer</dt><dd>${escapeHtml(sample.answer)}</dd>
      <dt>User Output</dt><dd>${escapeHtml(sample.actualOutput)}</dd>
    </dl>
    ${sample.message ? `<p>${escapeHtml(sample.message)}</p>` : ''}
    <p class="path">${escapeHtml(actualPath)}</p>
  </article>`;
}

function renderBlock(title: string, value: string): string {
  return `<article class="block">
    <h2>${escapeHtml(title)}</h2>
    <pre>${escapeHtml(value)}</pre>
  </article>`;
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return 'File not found.';
  }
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
    .sample,
    .block {
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
    .columns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    pre {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      margin: 0;
      min-height: 90px;
      overflow: auto;
      padding: 10px;
      white-space: pre-wrap;
    }
    .status { font-weight: 700; }
    .status-ac { color: var(--vscode-testing-iconPassed); }
    .status-wa,
    .status-tle,
    .status-re,
    .status-err { color: var(--vscode-testing-iconFailed); }
    .status-not-run { color: var(--vscode-descriptionForeground); }
    .path {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

function statusClass(status: string): string {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
