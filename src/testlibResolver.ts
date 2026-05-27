import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { exists, getOITestDir } from './config';
import { CheckerConfig } from './types';

export type TestlibResolveSource = 'checkerDir' | 'workspaceRoot' | 'managed' | 'custom' | 'missing';

export type TestlibResolveResult = {
  found: boolean;
  includeDir?: string;
  testlibPath?: string;
  source: TestlibResolveSource;
  message?: string;
};

export async function resolveTestlibForChecker(
  workspaceFolder: vscode.WorkspaceFolder,
  checkerSource: string,
  checkerConfig: CheckerConfig | undefined
): Promise<TestlibResolveResult> {
  const mode = checkerConfig?.testlib?.mode ?? 'auto';
  const candidates =
    mode === 'custom'
      ? [customCandidate(checkerConfig), managedCandidate(workspaceFolder), checkerDirCandidate(checkerSource), workspaceRootCandidate(workspaceFolder)]
      : mode === 'managed'
        ? [managedCandidate(workspaceFolder), checkerDirCandidate(checkerSource), workspaceRootCandidate(workspaceFolder), customCandidate(checkerConfig)]
        : [checkerDirCandidate(checkerSource), workspaceRootCandidate(workspaceFolder), managedCandidate(workspaceFolder), customCandidate(checkerConfig)];

  for (const candidate of candidates) {
    if (!candidate.path) {
      continue;
    }
    if (await exists(candidate.path)) {
      return {
        found: true,
        includeDir: path.dirname(candidate.path),
        testlibPath: candidate.path,
        source: candidate.source
      };
    }
  }

  return {
    found: false,
    source: 'missing',
    message: 'testlib.h not found'
  };
}

export function getManagedTestlibPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'tools', 'testlib', 'testlib.h');
}

export async function importTestlibToManaged(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string
): Promise<string> {
  const targetPath = getManagedTestlibPath(workspaceFolder);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);

  const sourceDir = path.dirname(sourcePath);
  for (const licenseName of ['LICENSE', 'LICENSE.txt']) {
    const licensePath = path.join(sourceDir, licenseName);
    if (await exists(licensePath)) {
      await fs.copyFile(licensePath, path.join(path.dirname(targetPath), 'LICENSE'));
      break;
    }
  }

  return targetPath;
}

function checkerDirCandidate(checkerSource: string): { path: string; source: TestlibResolveSource } {
  return { path: path.join(path.dirname(checkerSource), 'testlib.h'), source: 'checkerDir' };
}

function workspaceRootCandidate(workspaceFolder: vscode.WorkspaceFolder): { path: string; source: TestlibResolveSource } {
  return { path: path.join(workspaceFolder.uri.fsPath, 'testlib.h'), source: 'workspaceRoot' };
}

function managedCandidate(workspaceFolder: vscode.WorkspaceFolder): { path: string; source: TestlibResolveSource } {
  return { path: getManagedTestlibPath(workspaceFolder), source: 'managed' };
}

function customCandidate(checkerConfig: CheckerConfig | undefined): { path?: string; source: TestlibResolveSource } {
  return { path: checkerConfig?.testlib?.path ?? undefined, source: 'custom' };
}
