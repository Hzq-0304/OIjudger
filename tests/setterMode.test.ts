import { describe, expect, it } from 'vitest';
import {
  getSetterDataCases,
  isSetterModeEnabled,
  normalizeSetterConfig,
  removeSetterDataCaseForSample,
  upsertSetterDataCaseForSample,
  validateSetterSampleName
} from '../src/setterMode';
import { SampleConfig, SetterConfig } from '../src/types';

describe('setter mode config helpers', () => {
  it('normalizes empty setter config', () => {
    expect(normalizeSetterConfig(undefined)).toEqual({
      stdProgram: undefined,
      dataCases: [],
      generator: {
        enabled: false,
        generators: []
      }
    });
  });

  it('keeps setter mode disabled by default', () => {
    expect(isSetterModeEnabled()).toBe(false);
  });

  it('upserts a data case for a sample', () => {
    const setter = upsertSetterDataCaseForSample(undefined, sample({ id: 'sample-3', index: 3, name: 'read' }));
    expect(setter.dataCases).toEqual([
      {
        id: 'case-sample-3',
        name: 'read',
        sampleId: 'sample-3',
        sampleIndex: 3,
        role: 'sample'
      }
    ]);
  });

  it('updates an existing sample data case instead of duplicating it', () => {
    const initial: SetterConfig = {
      dataCases: [
        {
          id: 'case-sample-3',
          name: 'old',
          sampleId: 'sample-3',
          sampleIndex: 3,
          role: 'sample'
        }
      ]
    };

    const setter = upsertSetterDataCaseForSample(initial, sample({ id: 'sample-3', index: 3, name: 'read' }));
    expect(setter.dataCases).toHaveLength(1);
    expect(setter.dataCases?.[0].name).toBe('read');
  });

  it('removes the data case for a deleted sample', () => {
    const initial: SetterConfig = {
      dataCases: [
        { id: 'case-sample-1', name: 'one', sampleId: 'sample-1', sampleIndex: 1, role: 'sample' },
        { id: 'case-sample-2', name: 'two', sampleId: 'sample-2', sampleIndex: 2, role: 'sample' }
      ]
    };
    const setter = removeSetterDataCaseForSample(initial, sample({ id: 'sample-1', index: 1 }));
    expect(setter.dataCases?.map((entry) => entry.sampleId)).toEqual(['sample-2']);
  });

  it('sorts data cases by sample index', () => {
    const dataCases = getSetterDataCases({
      dataCases: [
        { id: 'case-sample-5', name: 'five', sampleId: 'sample-5', sampleIndex: 5, role: 'sample' },
        { id: 'case-sample-1', name: 'one', sampleId: 'sample-1', sampleIndex: 1, role: 'sample' },
        { id: 'case-sample-3', name: 'three', sampleId: 'sample-3', sampleIndex: 3, role: 'sample' }
      ]
    });
    expect(dataCases.map((entry) => entry.sampleIndex)).toEqual([1, 3, 5]);
  });

  it('does not require changing sample id or index when naming samples', () => {
    const original = sample({ id: 'sample-7', index: 7, name: 'Sample 7' });
    const renamed = { ...original, name: 'read' };
    const setter = upsertSetterDataCaseForSample(undefined, renamed);
    expect(renamed.id).toBe('sample-7');
    expect(renamed.index).toBe(7);
    expect(setter.dataCases?.[0]).toMatchObject({
      name: 'read',
      sampleId: 'sample-7',
      sampleIndex: 7
    });
  });

  it('validates setter sample display names', () => {
    expect(validateSetterSampleName('read')).toBe(true);
    expect(validateSetterSampleName('样例一')).toBe(true);
    expect(validateSetterSampleName('')).toBe(false);
    expect(validateSetterSampleName('a/b')).toBe(false);
    expect(validateSetterSampleName('a?b')).toBe(false);
    expect(validateSetterSampleName('line\nbreak')).toBe(false);
  });
});

function sample(overrides: Partial<SampleConfig>): SampleConfig {
  return {
    id: 'sample-1',
    index: 1,
    name: 'Sample 1',
    input: '1.in',
    answer: '1.ans',
    ...overrides
  };
}
