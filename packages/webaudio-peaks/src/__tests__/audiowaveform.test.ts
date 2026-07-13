import { describe, expect, it } from 'vitest';
import { parseAudiowaveformBinary, parseAudiowaveformJson } from '../index';

function makeBinary(options: {
  version: 1 | 2;
  bits: 8 | 16;
  channels: number;
  sampleRate?: number;
  samplesPerPixel?: number;
  data: number[];
}): ArrayBuffer {
  const length = options.data.length / (options.channels * 2);
  const headerLength = options.version === 1 ? 20 : 24;
  const buffer = new ArrayBuffer(headerLength + options.data.length * (options.bits / 8));
  const view = new DataView(buffer);
  view.setInt32(0, options.version, true);
  view.setUint32(4, options.bits === 8 ? 1 : 0, true);
  view.setInt32(8, options.sampleRate ?? 48000, true);
  view.setInt32(12, options.samplesPerPixel ?? 256, true);
  view.setUint32(16, length, true);
  if (options.version === 2) view.setInt32(20, options.channels, true);
  for (let index = 0; index < options.data.length; index++) {
    if (options.bits === 8) view.setInt8(headerLength + index, options.data[index]);
    else view.setInt16(headerLength + index * 2, options.data[index], true);
  }
  return buffer;
}

describe('audiowaveform binary parsing', () => {
  it('parses v1 mono 8-bit data', () => {
    const store = parseAudiowaveformBinary(
      makeBinary({ version: 1, bits: 8, channels: 1, data: [-10, 20, -30, 40] })
    );
    expect(store.channels).toBe(1);
    expect(store.bits).toBe(8);
    expect(Array.from(store.copyChannelData(0))).toEqual([-10, 20, -30, 40]);
  });

  it('parses v2 stereo 16-bit interleaving', () => {
    const store = parseAudiowaveformBinary(
      makeBinary({
        version: 2,
        bits: 16,
        channels: 2,
        data: [-10, 20, -30, 40, -50, 60, -70, 80],
      })
    );
    expect(Array.from(store.copyChannelData(0))).toEqual([-10, 20, -50, 60]);
    expect(Array.from(store.copyChannelData(1))).toEqual([-30, 40, -70, 80]);
  });

  it('rejects invalid headers, formats, and truncated data', () => {
    expect(() => parseAudiowaveformBinary(new ArrayBuffer(19))).toThrow('truncated');

    const invalidVersion = makeBinary({ version: 1, bits: 8, channels: 1, data: [-1, 1] });
    new DataView(invalidVersion).setInt32(0, 3, true);
    expect(() => parseAudiowaveformBinary(invalidVersion)).toThrow('version');

    const invalidFormat = makeBinary({ version: 1, bits: 8, channels: 1, data: [-1, 1] });
    new DataView(invalidFormat).setUint32(4, 2, true);
    expect(() => parseAudiowaveformBinary(invalidFormat)).toThrow('format');

    const truncated = makeBinary({ version: 2, bits: 16, channels: 2, data: [-1, 1, -2, 2] });
    new DataView(truncated).setUint32(16, 2, true);
    expect(() => parseAudiowaveformBinary(truncated)).toThrow('length');
  });
});

describe('audiowaveform JSON parsing', () => {
  it('parses v2 data and preserves an exact source frame count extension', () => {
    const store = parseAudiowaveformJson({
      version: 2,
      channels: 1,
      sample_rate: 48000,
      samples_per_pixel: 256,
      bits: 16,
      length: 2,
      source_frame_count: 300,
      data: [-10, 20, -30, 40],
    });
    expect(store.sourceFrameCount).toBe(300);
    expect(store.duration).toBe(300 / 48000);
  });

  it('rejects overflow bounds and malformed pairs', () => {
    expect(() =>
      parseAudiowaveformJson({
        version: 2,
        channels: Number.MAX_SAFE_INTEGER,
        sample_rate: 48000,
        samples_per_pixel: 256,
        bits: 16,
        length: Number.MAX_SAFE_INTEGER,
        data: [],
      })
    ).toThrow('safe integer');

    expect(() =>
      parseAudiowaveformJson({
        version: 1,
        sample_rate: 48000,
        samples_per_pixel: 256,
        bits: 8,
        length: 1,
        data: [10, -10],
      })
    ).toThrow('minimum');

    expect(() =>
      parseAudiowaveformJson({
        version: 1,
        sample_rate: 48000,
        samples_per_pixel: 256,
        bits: 8,
        length: 1,
        data: [-129, 10],
      })
    ).toThrow('range');
  });
});
