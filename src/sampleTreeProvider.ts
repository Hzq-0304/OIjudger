import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createDefaultConfig, exists, getConfigPath, getReportPath, getWorkspaceFolder, readConfig } from './config';
import { JudgeReport, OITestConfig, SampleConfig, SampleReport, SampleStatus } from './types';

type TreeKind = 'group' | 'info' | 'sample' | 'action';

type TreeNode = {
  kind: TreeKind;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  command?: vscode.Command;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  group?: 'currentFile' | 'limits' | 'samples' | 'actions';
  sample?: SampleConfig;
  report?: SampleReport;
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
    item.contextValue = element.kind === 'sample' ? 'oijudgerSample' : `oijudger${capitalize(element.kind)}`;
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return [];
    }

    try {
      const config = await readUiConfig(workspaceFolder);
      const report = await readReport(workspaceFolder);

      if (!element) {
        return createRootNodes();
      }

      switch (element.group) {
        case 'currentFile':
          return [createCurrentFileNode()];
        case 'limits':
          return createLimitNodes(config);
        case 'samples':
          return createSampleNodes(config, report);
        case 'actions':
          return createActionNodes();
        default:
          return [];
      }
    } catch {
      return [];
    }
  }
}

async function readUiConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return createDefaultConfig();
  }
  return readConfig(workspaceFolder);
}

function createRootNodes(): TreeNode[] {
  return [
    {
      kind: 'group',
      label: 'Current File',
      icon: new vscode.ThemeIcon('file-code'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'currentFile'
    },
    {
      kind: 'group',
      label: 'Limits',
      icon: new vscode.ThemeIcon('dashboard'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'limits'
    },
    {
      kind: 'group',
      label: 'Samples',
      icon: new vscode.ThemeIcon('list-tree'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'samples'
    },
    {
      kind: 'group',
      label: 'Actions',
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'actions'
    }
  ];
}

function createCurrentFileNode(): TreeNode {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return {
      kind: 'info',
      label: 'No active file',
      description: 'Open a C++ file',
      icon: new vscode.ThemeIcon('circle-slash')
    };
  }

  return {
    kind: 'info',
    label: path.basename(editor.document.uri.fsPath),
    description: path.dirname(editor.document.uri.fsPath),
    tooltip: editor.document.uri.fsPath,
    icon: new vscode.ThemeIcon('file-code')
  };
}

function createLimitNodes(config: OITestConfig): TreeNode[] {
  return [
    {
      kind: 'info',
      label: `Time: ${config.limits.timeMs} ms`,
      command: {
        command: 'oijudger.setTimeLimit',
        title: 'Set Time Limit'
      },
      icon: new vscode.ThemeIcon('watch')
    },
    {
      kind: 'info',
      label: `Memory: ${config.limits.memoryMb} MB`,
      command: {
        command: 'oijudger.setMemoryLimit',
        title: 'Set Memory Limit'
      },
      icon: new vscode.ThemeIcon('server')
    }
  ];
}

function createSampleNodes(config: OITestConfig, report: JudgeReport | undefined): TreeNode[] {
  if (config.samples.length === 0) {
    return [
      {
        kind: 'info',
        label: 'No samples',
        description: 'Add Sample',
        command: {
          command: 'oijudger.addSample',
          title: 'Add Sample'
        },
        icon: new vscode.ThemeIcon('beaker-stop')
      }
    ];
  }

  return config.samples.map((sample) => {
    const sampleReport = report?.samples.find((entry) => entry.id === sample.id);
    const status = sampleReport?.status ?? 'Not Run';
    const elapsed = sampleReport ? formatElapsed(sampleReport) : '';
    return {
      kind: 'sample',
      label: sample.name,
      description: elapsed ? `${status}  ${elapsed}` : status,
      tooltip: `${sample.input} -> ${sample.answer}`,
      icon: new vscode.ThemeIcon(statusIcon(status)),
      command: {
        command: 'oijudger.openSampleDetail',
        title: 'Open Sample Detail',
        arguments: [sample.id]
      },
      sample,
      report: sampleReport
    };
  });
}

function createActionNodes(): TreeNode[] {
  return [
    actionNode('Init Problem', 'oijudger.initProblem', 'repo-create'),
    actionNode('Add Sample', 'oijudger.addSample', 'add'),
    actionNode('Run All Samples', 'oijudger.runAllSamples', 'run-all'),
    actionNode('Set Time Limit', 'oijudger.setTimeLimit', 'watch'),
    actionNode('Set Memory Limit', 'oijudger.setMemoryLimit', 'server'),
    actionNode('Open Last Report', 'oijudger.openLastReport', 'preview'),
    actionNode('Clear Outputs', 'oijudger.clearOutputs', 'trash')
  ];
}

function actionNode(label: string, command: string, icon: string): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    command: {
      command,
      title: label
    }
  };
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

function formatElapsed(report: SampleReport): string {
  if (report.status === 'TLE') {
    return `>${report.elapsedMs}ms`;
  }
  return `${report.elapsedMs}ms`;
}

function statusIcon(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return 'pass-filled';
    case 'WA':
      return 'error';
    case 'TLE':
      return 'watch';
    case 'RE':
    case 'ERR':
      return 'warning';
    case 'Not Run':
      return 'circle-outline';
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
