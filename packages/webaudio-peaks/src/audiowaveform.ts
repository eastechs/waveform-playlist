import type { Bits, Peaks } from '@waveform-playlist/core';
import { PeakStore } from './peakStore';

export interface AudiowaveformJson {
  version: 1 | 2;
  channels?: number;
  sample_rate: number;
  samples_per_pixel: number;
  bits: Bits;
  length: number;
  data: number[];
  source_frame_count?: number;
}

function assertSafeInteger(value: unknown, name: string, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
}

function checkedProduct(values: number[], name: string): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result)) {
      throw new RangeError(`${name} exceeds the safe integer range`);
    }
  }
  return result;
}

function deinterleave(
  values: ArrayLike<number>,
  channels: number,
  length: number,
  bits: Bits
): Peaks[] {
  const data = Array.from({ length: channels }, () =>
    bits === 8 ? new Int8Array(length * 2) : new Int16Array(length * 2)
  );

  for (let point = 0; point < length; point++) {
    for (let channel = 0; channel < channels; channel++) {
      const sourceOffset = (point * channels + channel) * 2;
      data[channel][point * 2] = values[sourceOffset];
      data[channel][point * 2 + 1] = values[sourceOffset + 1];
    }
  }
  return data;
}

function createStore(
  sampleRate: number,
  samplesPerPixel: number,
  bits: Bits,
  channels: number,
  length: number,
  sourceFrameCount: number,
  values: ArrayLike<number>
): PeakStore {
  assertSafeInteger(sampleRate, 'sample_rate', 1);
  assertSafeInteger(samplesPerPixel, 'samples_per_pixel', 1);
  assertSafeInteger(channels, 'channels', 1);
  assertSafeInteger(length, 'length', 0);
  assertSafeInteger(sourceFrameCount, 'source_frame_count', 0);
  if (bits !== 8 && bits !== 16) throw new RangeError('bits must be 8 or 16');

  const valueCount = checkedProduct([length, channels, 2], 'waveform data length');
  if (values.length !== valueCount) {
    throw new RangeError(`Expected ${valueCount} waveform values, received ${values.length}`);
  }
  if (sourceFrameCount > checkedProduct([length, samplesPerPixel], 'waveform frame capacity')) {
    throw new RangeError('source_frame_count exceeds the represented waveform range');
  }

  const minimum = bits === 8 ? -128 : -32768;
  const maximum = bits === 8 ? 127 : 32767;
  for (let point = 0; point < length; point++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = (point * channels + channel) * 2;
      const min = values[offset];
      const max = values[offset + 1];
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new TypeError('Waveform values must be integers');
      }
      if (min < minimum || min > maximum || max < minimum || max > maximum) {
        throw new RangeError(`Waveform values exceed the signed ${bits}-bit range`);
      }
      if (min > max) throw new RangeError('Waveform minimum must not exceed its maximum');
    }
  }

  return new PeakStore({
    sampleRate,
    sourceFrameCount,
    samplesPerPixel,
    bits,
    data: deinterleave(values, channels, length, bits),
  });
}

export function parseAudiowaveformBinary(buffer: ArrayBuffer): PeakStore {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Expected an ArrayBuffer');
  if (buffer.byteLength < 20) throw new RangeError('Waveform binary header is truncated');

  const view = new DataView(buffer);
  const version = view.getInt32(0, true);
  if (version !== 1 && version !== 2) {
    throw new RangeError(`Unsupported waveform binary version ${version}`);
  }

  const headerLength = version === 1 ? 20 : 24;
  if (buffer.byteLength < headerLength) throw new RangeError('Waveform binary header is truncated');

  const format = view.getUint32(4, true);
  if (format !== 0 && format !== 1) throw new RangeError('Waveform binary format is invalid');
  const bits: Bits = format === 1 ? 8 : 16;
  const sampleRate = view.getInt32(8, true);
  const samplesPerPixel = view.getInt32(12, true);
  const length = view.getUint32(16, true);
  const channels = version === 1 ? 1 : view.getInt32(20, true);

  assertSafeInteger(sampleRate, 'sample_rate', 1);
  assertSafeInteger(samplesPerPixel, 'samples_per_pixel', 1);
  assertSafeInteger(channels, 'channels', 1);
  const bytesPerValue = bits / 8;
  const dataBytes = checkedProduct([length, channels, 2, bytesPerValue], 'waveform byte length');
  if (headerLength + dataBytes !== buffer.byteLength) {
    throw new RangeError('Waveform binary length does not match its header');
  }

  const valueCount = checkedProduct([length, channels, 2], 'waveform value count');
  const values = new Array<number>(valueCount);
  for (let index = 0; index < valueCount; index++) {
    values[index] =
      bits === 8
        ? view.getInt8(headerLength + index)
        : view.getInt16(headerLength + index * 2, true);
  }
  const sourceFrameCount = checkedProduct([length, samplesPerPixel], 'source frame count');
  return createStore(sampleRate, samplesPerPixel, bits, channels, length, sourceFrameCount, values);
}

export function parseAudiowaveformJson(input: unknown): PeakStore {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Waveform JSON must be an object');
  }
  const json = input as Partial<AudiowaveformJson>;
  if (json.version !== 1 && json.version !== 2) {
    throw new RangeError('Waveform JSON version must be 1 or 2');
  }
  if (!Array.isArray(json.data)) throw new TypeError('Waveform JSON data must be an array');

  const channels = json.version === 1 ? 1 : json.channels;
  assertSafeInteger(json.sample_rate, 'sample_rate', 1);
  assertSafeInteger(json.samples_per_pixel, 'samples_per_pixel', 1);
  assertSafeInteger(channels, 'channels', 1);
  assertSafeInteger(json.length, 'length', 0);
  if (json.bits !== 8 && json.bits !== 16) throw new RangeError('bits must be 8 or 16');

  const capacity = checkedProduct([json.length, json.samples_per_pixel], 'source frame count');
  const sourceFrameCount = json.source_frame_count ?? capacity;
  return createStore(
    json.sample_rate,
    json.samples_per_pixel,
    json.bits,
    channels,
    json.length,
    sourceFrameCount,
    json.data
  );
}

export function parseAudiowaveform(input: ArrayBuffer | unknown): PeakStore {
  return input instanceof ArrayBuffer
    ? parseAudiowaveformBinary(input)
    : parseAudiowaveformJson(input);
}
