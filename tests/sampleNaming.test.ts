import { describe, expect, it } from 'vitest';
import {
  createSampleInternalId,
  getNextSampleIndex,
  getSampleDisplayNameFromInput,
  getSampleOutputDirRel,
  normalizeSampleInternalId,
  resolveSampleIndex,
  uniqueSampleName
} from '../src/sampleUtils';
import { SampleConfig } from '../src/types';

describe('sample naming and internal indices', () => {
  it.each([
    ['C:\\data\\book3.in', 'book3'],
    ['C:\\data\\test_large.in', 'test_large'],
    ['C:\\data\\001.in', '001']
  ])('uses input basename for %s', (inputPath, expected) => {
    expect(getSampleDisplayNameFromInput(inputPath)).toBe(expected);
  });

  it('deduplicates sample display names', () => {
    expect(uniqueSampleName([{ name: 'book3' }], 'book3')).toBe('book3 (2)');
    expect(uniqueSampleName([{ name: 'book3' }, { name: 'book3 (2)' }], 'book3')).toBe('book3 (3)');
  });

  it('uses max existing index plus one', () => {
    expect(getNextSampleIndex({
      samples: [
        sample({ index: 1 }),
        sample({ index: 2 }),
        sample({ index: 5 })
      ]
    })).toBe(6);
  });

  it('generates stable internal ids from index', () => {
    expect(createSampleInternalId(7)).toBe('sample-7');
  });

  it('infers legacy Sample x index and id', () => {
    const legacy = sample({
      id: undefined as unknown as string,
      index: undefined as unknown as number,
      name: 'Sample 3',
      input: '.oitest/problems/A/samples/3.in',
      answer: '.oitest/problems/A/samples/3.ans'
    });
    const index = resolveSampleIndex(legacy, 1);
    expect(index).toBe(3);
    expect(normalizeSampleInternalId(legacy.id, index)).toBe('sample-3');
  });

  it('uses sample index rather than display name for output directory', () => {
    expect(getSampleOutputDirRel('A', 7)).toBe('.oitest/problems/A/outputs/sample-7');
    expect(getSampleOutputDirRel('A', 7)).not.toContain('book3');
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
