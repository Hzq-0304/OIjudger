import * as vscode from 'vscode';
import { SampleConfig, SetterConfig, SetterDataCaseConfig } from './types';

export interface GenerateDataRequest {
  problemId: string;
  caseId: string;
  sampleIndex?: number;
  name: string;
}

export interface GenerateDataResult {
  inputPath?: string;
  answerPath?: string;
  message?: string;
}

export function isSetterModeEnabled(): boolean {
  return vscode.workspace.getConfiguration('oijudger').get<boolean>('setterMode.enabled', false);
}

export function normalizeSetterConfig(setter: SetterConfig | undefined): SetterConfig {
  return {
    stdProgram: setter?.stdProgram,
    dataCases: getSetterDataCases(setter),
    generator: {
      enabled: setter?.generator?.enabled ?? false,
      generators: setter?.generator?.generators ?? []
    }
  };
}

export function upsertSetterDataCaseForSample(
  setter: SetterConfig | undefined,
  sample: Pick<SampleConfig, 'id' | 'index' | 'name'>
): SetterConfig {
  const normalized = normalizeSetterConfig(setter);
  const existing = normalized.dataCases?.find((entry) => entry.sampleId === sample.id);
  const dataCase: SetterDataCaseConfig = {
    ...(existing ?? {}),
    id: existing?.id ?? `case-${sample.id}`,
    name: sample.name,
    sampleId: sample.id,
    sampleIndex: sample.index,
    role: 'sample'
  };
  const dataCases = [
    ...(normalized.dataCases ?? []).filter((entry) => entry.sampleId !== sample.id),
    dataCase
  ];
  return {
    ...normalized,
    dataCases: sortSetterDataCases(dataCases)
  };
}

export function removeSetterDataCaseForSample(
  setter: SetterConfig | undefined,
  sample: Pick<SampleConfig, 'id' | 'index'> | string
): SetterConfig {
  const normalized = normalizeSetterConfig(setter);
  const sampleId = typeof sample === 'string' ? sample : sample.id;
  const sampleIndex = typeof sample === 'string' ? undefined : sample.index;
  return {
    ...normalized,
    dataCases: (normalized.dataCases ?? []).filter((entry) =>
      entry.sampleId !== sampleId && (sampleIndex === undefined || entry.sampleIndex !== sampleIndex)
    )
  };
}

export function getSetterDataCases(setter: SetterConfig | undefined): SetterDataCaseConfig[] {
  return sortSetterDataCases([...(setter?.dataCases ?? [])]);
}

export function validateSetterSampleName(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && !/[<>:"/\\|?*\r\n]/u.test(trimmed);
}

function sortSetterDataCases(dataCases: SetterDataCaseConfig[]): SetterDataCaseConfig[] {
  return dataCases.sort((left, right) => {
    const leftIndex = left.sampleIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.sampleIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}
