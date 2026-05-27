import * as path from 'path';
import * as vscode from 'vscode';
import { exists, resolveWorkspacePath, toPosixPath } from './config';
import { SampleConfig, SampleSourceType } from './types';

export type SampleFileStatus = {
  inputPath: string;
  answerPath: string;
  inputMissing: boolean;
  answerMissing: boolean;
  missingPaths: string[];
};

export type SampleOutputPaths = {
  outputRel: string;
  outputPath: string;
  stderrRel: string;
  stderrPath: string;
  diffRel: string;
  diffPath: string;
  legacyOutputRel: string;
  legacyOutputPath: string;
  legacyStderrRel: string;
  legacyStderrPath: string;
  legacyDiffRel: string;
  legacyDiffPath: string;
};

export function resolveSamplePath(workspaceFolder: vscode.WorkspaceFolder, samplePath: string): string {
  return path.isAbsolute(samplePath) ? samplePath : resolveWorkspacePath(workspaceFolder, samplePath);
}

export function inferSampleSourceType(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: Pick<SampleConfig, 'input' | 'answer' | 'sourceType'>
): SampleSourceType {
  if (sample.sourceType === 'managed' || sample.sourceType === 'external') {
    return sample.sourceType;
  }

  const oitestRoot = path.join(workspaceFolder.uri.fsPath, '.oitest');
  const inputPath = resolveSamplePath(workspaceFolder, sample.input);
  const answerPath = resolveSamplePath(workspaceFolder, sample.answer);
  return isUnderPath(inputPath, oitestRoot) && isUnderPath(answerPath, oitestRoot) ? 'managed' : 'external';
}

export async function getSampleFileStatus(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig
): Promise<SampleFileStatus> {
  const inputPath = resolveSamplePath(workspaceFolder, sample.input);
  const answerPath = resolveSamplePath(workspaceFolder, sample.answer);
  const inputMissing = !(await exists(inputPath));
  const answerMissing = !(await exists(answerPath));
  const missingPaths = [
    ...(inputMissing ? [inputPath] : []),
    ...(answerMissing ? [answerPath] : [])
  ];

  return {
    inputPath,
    answerPath,
    inputMissing,
    answerMissing,
    missingPaths
  };
}

export function getProblemSampleOutputPaths(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number
): SampleOutputPaths {
  const outputRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${sampleId}`, 'useroutput.txt'));
  const stderrRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${sampleId}`, 'stderr.txt'));
  const diffRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${sampleId}`, 'diff.txt'));
  const legacyOutputRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `${sampleId}.out`));
  const legacyStderrRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `${sampleId}.err`));
  const legacyDiffRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `${sampleId}.diff`));

  return {
    outputRel,
    outputPath: resolveSamplePath(workspaceFolder, outputRel),
    stderrRel,
    stderrPath: resolveSamplePath(workspaceFolder, stderrRel),
    diffRel,
    diffPath: resolveSamplePath(workspaceFolder, diffRel),
    legacyOutputRel,
    legacyOutputPath: resolveSamplePath(workspaceFolder, legacyOutputRel),
    legacyStderrRel,
    legacyStderrPath: resolveSamplePath(workspaceFolder, legacyStderrRel),
    legacyDiffRel,
    legacyDiffPath: resolveSamplePath(workspaceFolder, legacyDiffRel)
  };
}

export function getLegacyOutputRel(sample: SampleConfig): string {
  return sample.actualOutput ?? toPosixPath(path.join('.oitest', 'outputs', `${sample.id}.out`));
}

export async function findExistingUserOutput(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId?: string
): Promise<string | undefined> {
  const candidates = getUserOutputCandidates(workspaceFolder, sample, problemId);
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function findExistingStderrOutput(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId?: string
): Promise<string | undefined> {
  const candidates = getStderrOutputCandidates(workspaceFolder, sample, problemId);
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function getUserOutputCandidates(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId?: string
): string[] {
  const candidates = new Set<string>();
  if (problemId) {
    const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.id);
    candidates.add(paths.outputPath);
    candidates.add(paths.legacyOutputPath);
  }
  if (sample.actualOutput) {
    candidates.add(resolveSamplePath(workspaceFolder, sample.actualOutput));
  }
  return [...candidates];
}

export function getStderrOutputCandidates(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId?: string
): string[] {
  const candidates = new Set<string>();
  if (problemId) {
    const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.id);
    candidates.add(paths.stderrPath);
    candidates.add(paths.legacyStderrPath);
  }
  if (sample.actualOutput) {
    candidates.add(resolveSamplePath(workspaceFolder, sample.actualOutput).replace(/\.out$/u, '.err'));
  }
  return [...candidates];
}

export function isUnderPath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
