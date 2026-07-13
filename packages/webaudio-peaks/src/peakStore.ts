import type { Bits, PeakData, Peaks, WaveformDataObject } from '@waveform-playlist/core';

export interface PeakStoreOptions {
  sampleRate: number;
  sourceFrameCount: number;
  samplesPerPixel: number;
  bits: Bits;
  data: Peaks[];
  viewStartFrame?: number;
  viewEndFrame?: number;
  dataStartFrame?: number;
}

export interface PeakStoreChannel {
  min_array(): number[];
  max_array(): number[];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function copyPeaks(peaks: Peaks): Peaks {
  return peaks instanceof Int8Array ? new Int8Array(peaks) : new Int16Array(peaks);
}

function makePeaks(bits: Bits, length: number): Peaks {
  return bits === 8 ? new Int8Array(length) : new Int16Array(length);
}

function validateChannelData(data: Peaks[], bits: Bits): number {
  if (data.length === 0) {
    throw new RangeError('Peak data must contain at least one channel');
  }

  const expectedConstructor = bits === 8 ? Int8Array : Int16Array;
  const pairLength = data[0].length;
  if (pairLength % 2 !== 0) {
    throw new RangeError('Peak channel data must contain interleaved min/max pairs');
  }

  for (const channel of data) {
    if (!(channel instanceof expectedConstructor)) {
      throw new TypeError(`Peak channel data must use ${expectedConstructor.name}`);
    }
    if (channel.length !== pairLength) {
      throw new RangeError('Every peak channel must have the same number of pairs');
    }
  }

  return pairLength / 2;
}

/**
 * Immutable, typed-array-backed waveform peaks.
 *
 * The public shape intentionally matches WaveformDataObject so existing
 * waveform-playlist consumers can use generated and audiowaveform peaks
 * without depending on a particular parser implementation.
 */
export class PeakStore implements WaveformDataObject {
  readonly sample_rate: number;
  readonly sourceFrameCount: number;
  readonly scale: number;
  readonly bits: Bits;
  readonly channels: number;
  readonly length: number;
  readonly viewStartFrame: number;
  readonly viewEndFrame: number;
  readonly dataStartFrame: number;

  readonly #data: readonly Peaks[];

  constructor(options: PeakStoreOptions) {
    assertPositiveInteger(options.sampleRate, 'sampleRate');
    assertNonNegativeInteger(options.sourceFrameCount, 'sourceFrameCount');
    assertPositiveInteger(options.samplesPerPixel, 'samplesPerPixel');
    if (options.bits !== 8 && options.bits !== 16) {
      throw new RangeError('bits must be 8 or 16');
    }

    const length = validateChannelData(options.data, options.bits);
    const viewStartFrame = options.viewStartFrame ?? 0;
    const viewEndFrame = options.viewEndFrame ?? options.sourceFrameCount;
    const dataStartFrame = options.dataStartFrame ?? viewStartFrame;

    assertNonNegativeInteger(viewStartFrame, 'viewStartFrame');
    assertNonNegativeInteger(viewEndFrame, 'viewEndFrame');
    assertNonNegativeInteger(dataStartFrame, 'dataStartFrame');
    if (viewStartFrame > viewEndFrame || viewEndFrame > options.sourceFrameCount) {
      throw new RangeError('Peak view must be contained within the source frame range');
    }
    if (dataStartFrame > viewStartFrame) {
      throw new RangeError('Peak data must start at or before the view');
    }
    if (viewStartFrame === viewEndFrame && length !== 0) {
      throw new RangeError('An empty peak view cannot contain data');
    }
    if (viewStartFrame < viewEndFrame && length === 0) {
      throw new RangeError('A non-empty peak view requires data');
    }
    const dataFrameCount = length * options.samplesPerPixel;
    if (!Number.isSafeInteger(dataFrameCount)) {
      throw new RangeError('Peak data frame coverage exceeds the safe integer range');
    }
    if (dataStartFrame + dataFrameCount < viewEndFrame) {
      throw new RangeError('Peak data does not cover the complete view');
    }

    this.sample_rate = options.sampleRate;
    this.sourceFrameCount = options.sourceFrameCount;
    this.scale = options.samplesPerPixel;
    this.bits = options.bits;
    this.channels = options.data.length;
    this.length = length;
    this.viewStartFrame = viewStartFrame;
    this.viewEndFrame = viewEndFrame;
    this.dataStartFrame = dataStartFrame;
    this.#data = Object.freeze(options.data.map(copyPeaks));
  }

  get duration(): number {
    return (this.viewEndFrame - this.viewStartFrame) / this.sample_rate;
  }

  channel(index: number): PeakStoreChannel {
    if (!Number.isInteger(index) || index < 0 || index >= this.channels) {
      throw new RangeError(`Channel index ${index} is out of range`);
    }

    const channel = this.#data[index];
    return {
      min_array: () => {
        const values = new Array<number>(this.length);
        for (let i = 0; i < this.length; i++) values[i] = channel[i * 2];
        return values;
      },
      max_array: () => {
        const values = new Array<number>(this.length);
        for (let i = 0; i < this.length; i++) values[i] = channel[i * 2 + 1];
        return values;
      },
    };
  }

  copyChannelData(index: number): Peaks {
    if (!Number.isInteger(index) || index < 0 || index >= this.channels) {
      throw new RangeError(`Channel index ${index} is out of range`);
    }
    return copyPeaks(this.#data[index]);
  }

  toPeakData(isMono: boolean = false): PeakData {
    if (!isMono || this.channels === 1) {
      return {
        length: this.length,
        data: this.#data.map(copyPeaks),
        bits: this.bits,
      };
    }

    const mono = makePeaks(this.bits, this.length * 2);
    for (let i = 0; i < this.length; i++) {
      let min = 0;
      let max = 0;
      for (const channel of this.#data) {
        min += channel[i * 2] / this.channels;
        max += channel[i * 2 + 1] / this.channels;
      }
      mono[i * 2] = min;
      mono[i * 2 + 1] = max;
    }

    return { length: this.length, data: [mono], bits: this.bits };
  }

  sliceFrames(startFrame: number, endFrame: number): PeakStore {
    assertNonNegativeInteger(startFrame, 'startFrame');
    assertNonNegativeInteger(endFrame, 'endFrame');
    if (startFrame >= endFrame) {
      throw new RangeError('Peak slice must contain at least one source frame');
    }

    const absoluteStart = Math.min(this.viewEndFrame, Math.max(this.viewStartFrame, startFrame));
    const absoluteEnd = Math.max(absoluteStart, Math.min(this.viewEndFrame, endFrame));
    if (absoluteStart >= absoluteEnd || this.length === 0) {
      return new PeakStore({
        sampleRate: this.sample_rate,
        sourceFrameCount: this.sourceFrameCount,
        samplesPerPixel: this.scale,
        bits: this.bits,
        data: this.#data.map(() => makePeaks(this.bits, 0)),
        viewStartFrame: absoluteStart,
        viewEndFrame: absoluteStart,
        dataStartFrame: absoluteStart,
      });
    }

    const startIndex = Math.max(0, Math.floor((absoluteStart - this.dataStartFrame) / this.scale));
    const endIndex = Math.min(
      this.length,
      Math.ceil((absoluteEnd - this.dataStartFrame) / this.scale)
    );
    const dataStartFrame = this.dataStartFrame + startIndex * this.scale;
    const data = this.#data.map((channel) =>
      copyPeaks(channel.subarray(startIndex * 2, endIndex * 2))
    );

    return new PeakStore({
      sampleRate: this.sample_rate,
      sourceFrameCount: this.sourceFrameCount,
      samplesPerPixel: this.scale,
      bits: this.bits,
      data,
      viewStartFrame: absoluteStart,
      viewEndFrame: absoluteEnd,
      dataStartFrame,
    });
  }

  slice(
    options: { startTime: number; endTime: number } | { startIndex: number; endIndex: number }
  ): PeakStore {
    if ('startTime' in options) {
      if (!Number.isFinite(options.startTime) || !Number.isFinite(options.endTime)) {
        throw new RangeError('Peak slice times must be finite');
      }
      return this.sliceFrames(
        Math.floor(options.startTime * this.sample_rate),
        Math.ceil(options.endTime * this.sample_rate)
      );
    }

    assertNonNegativeInteger(options.startIndex, 'startIndex');
    assertNonNegativeInteger(options.endIndex, 'endIndex');
    if (options.startIndex >= options.endIndex || options.endIndex > this.length) {
      throw new RangeError('Peak slice indices are out of range');
    }
    return this.sliceFrames(
      this.dataStartFrame + options.startIndex * this.scale,
      Math.min(this.viewEndFrame, this.dataStartFrame + options.endIndex * this.scale)
    );
  }

  resample(options: { scale: number } | { width: number }): PeakStore {
    if ('width' in options) assertPositiveInteger(options.width, 'width');
    const targetScale =
      'scale' in options
        ? options.scale
        : Math.max(1, Math.ceil((this.viewEndFrame - this.viewStartFrame) / options.width));
    assertPositiveInteger(targetScale, 'scale');
    if (targetScale < this.scale) {
      throw new RangeError('PeakStore can only resample to a coarser scale');
    }
    if (targetScale === this.scale) return this;

    const viewFrameCount = this.viewEndFrame - this.viewStartFrame;
    const targetLength = Math.ceil(viewFrameCount / targetScale);
    const data = this.#data.map(() => makePeaks(this.bits, targetLength * 2));

    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const targetStart = this.viewStartFrame + targetIndex * targetScale;
      const targetEnd = Math.min(this.viewEndFrame, targetStart + targetScale);
      const sourceStart = Math.max(0, Math.floor((targetStart - this.dataStartFrame) / this.scale));
      const sourceEnd = Math.min(
        this.length,
        Math.ceil((targetEnd - this.dataStartFrame) / this.scale)
      );

      for (let channelIndex = 0; channelIndex < this.channels; channelIndex++) {
        const source = this.#data[channelIndex];
        let min = Infinity;
        let max = -Infinity;
        for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex++) {
          min = Math.min(min, source[sourceIndex * 2]);
          max = Math.max(max, source[sourceIndex * 2 + 1]);
        }
        data[channelIndex][targetIndex * 2] = min === Infinity ? 0 : min;
        data[channelIndex][targetIndex * 2 + 1] = max === -Infinity ? 0 : max;
      }
    }

    return new PeakStore({
      sampleRate: this.sample_rate,
      sourceFrameCount: this.sourceFrameCount,
      samplesPerPixel: targetScale,
      bits: this.bits,
      data,
      viewStartFrame: this.viewStartFrame,
      viewEndFrame: this.viewEndFrame,
      dataStartFrame: this.viewStartFrame,
    });
  }
}
