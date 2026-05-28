import * as path from 'path';
import { OITestConfig, SampleConfig } from './types';

export function getNextSampleIndex(config: Pick<OITestConfig, 'samples'>): number {
  return config.samples.reduce((maxId, sample) => Math.max(maxId, ...sampleNumberCandidates(sample)), 0) + 1;
}

export function createSampleInternalId(index: number): string {
  return `sample-${index}`;
}

export function getSampleDisplayNameFromInput(inputPath: string): string {
  return path.parse(inputPath).name || path.basename(inputPath) || 'sample';
}

export function uniqueSampleName(samples: Array<Pick<SampleConfig, 'name'>>, desiredName: string): string {
  const baseName = desiredName.trim() || 'sample';
  const existing = new Set(samples.map((sample) => sample.name.toLowerCase()));
  if (!existing.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (existing.has(`${baseName} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} (${suffix})`;
}

export function resolveSampleIndex(sample: SampleConfig, fallbackIndex: number): number {
  return sampleNumberCandidates(sample).find((value) => value > 0) ?? fallbackIndex;
}

export function normalizeSampleInternalId(id: SampleConfig['id'] | number | undefined, index: number): string {
  return typeof id === 'string' && id.trim() ? id : createSampleInternalId(index);
}

export function getSampleOutputDirRel(problemId: string, sampleIndex: number): string {
  return toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${sampleIndex}`));
}

function sampleNumberCandidates(sample: SampleConfig): number[] {
  const values = [
    sample.index,
    parseSampleIndexFromId(sample.id),
    sample.id,
    parseSampleNumber(sample.name),
    parseSampleNumber(sample.input),
    parseSampleNumber(sample.answer),
    parseSampleNumber(sample.actualOutput ?? '')
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : [0];
}

function parseSampleIndexFromId(value: SampleConfig['id'] | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  const match = /^sample-(\d+)$/iu.exec(value ?? '');
  return match ? Number(match[1]) : undefined;
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

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
