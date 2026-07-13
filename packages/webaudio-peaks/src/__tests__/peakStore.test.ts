import { describe, expect, it } from 'vitest';
import { PeakStore, createPeakStoreFromChannels, createPeakStoreFromAudioBuffer } from '../index';

describe('PeakStore extraction', () => {
  it('extracts silence, impulses, clipping, and a partial final bin', () => {
    const store = createPeakStoreFromChannels(
      [new Float32Array([0, 0, -1, 1, -2, 2, 0.25])],
      48000,
      2,
      16
    );

    expect(store.sourceFrameCount).toBe(7);
    expect(store.length).toBe(4);
    expect(Array.from(store.copyChannelData(0))).toEqual([
      0, 0, -32768, 32767, -32768, 32767, 8191, 8191,
    ]);
  });

  it('keeps stereo channels independent and can produce mono peaks', () => {
    const store = createPeakStoreFromChannels(
      [new Float32Array([-1, 0.5]), new Float32Array([-0.5, 1])],
      44100,
      2,
      8
    );

    expect(store.channels).toBe(2);
    expect(Array.from(store.copyChannelData(0))).toEqual([-128, 63]);
    expect(Array.from(store.copyChannelData(1))).toEqual([-64, 127]);
    expect(Array.from(store.toPeakData(true).data[0])).toEqual([-96, 95]);
  });

  it('accepts an AudioBuffer without exposing its channel arrays', () => {
    const channel = new Float32Array([-0.25, 0.25]);
    const store = createPeakStoreFromAudioBuffer(
      {
        numberOfChannels: 1,
        length: 2,
        duration: 2 / 48000,
        sampleRate: 48000,
        getChannelData: () => channel,
      } as unknown as AudioBuffer,
      2,
      16
    );
    channel.fill(1);

    expect(Array.from(store.copyChannelData(0))).toEqual([-8192, 8191]);
  });
});

describe('PeakStore views', () => {
  const store = new PeakStore({
    sampleRate: 8,
    sourceFrameCount: 16,
    samplesPerPixel: 2,
    bits: 16,
    data: [new Int16Array([-1, 1, -9, 2, -3, 8, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8])],
  });

  it('resamples with min-of-mins and max-of-maxes', () => {
    const resampled = store.resample({ scale: 8 });
    expect(resampled.length).toBe(2);
    expect(Array.from(resampled.copyChannelData(0))).toEqual([-9, 8, -8, 8]);
  });

  it('keeps exact frame boundaries for aligned and unaligned slices', () => {
    const aligned = store.sliceFrames(4, 12);
    expect(aligned.viewStartFrame).toBe(4);
    expect(aligned.viewEndFrame).toBe(12);
    expect(Array.from(aligned.copyChannelData(0))).toEqual([-3, 8, -4, 4, -5, 5, -6, 6]);

    const unaligned = store.sliceFrames(3, 11);
    expect(unaligned.viewStartFrame).toBe(3);
    expect(unaligned.viewEndFrame).toBe(11);
    expect(Array.from(unaligned.copyChannelData(0))).toEqual([-9, 2, -3, 8, -4, 4, -5, 5, -6, 6]);
  });

  it('never drops an envelope extreme when resampling an unaligned slice', () => {
    const resampled = store.sliceFrames(3, 11).resample({ scale: 8 });
    expect(Array.from(resampled.copyChannelData(0))).toEqual([-9, 8]);
  });

  it('returns defensive channel copies', () => {
    const copy = store.copyChannelData(0);
    copy.fill(0);
    expect(store.channel(0).min_array()[0]).toBe(-1);
  });

  it('rejects finer resampling', () => {
    expect(() => store.resample({ scale: 1 })).toThrow('coarser');
    expect(() => store.resample({ width: 0 })).toThrow('width');
  });

  it('rejects peak data that does not cover its view', () => {
    expect(
      () =>
        new PeakStore({
          sampleRate: 8,
          sourceFrameCount: 16,
          samplesPerPixel: 2,
          bits: 16,
          data: [new Int16Array([-1, 1])],
        })
    ).toThrow('cover');
  });
});
