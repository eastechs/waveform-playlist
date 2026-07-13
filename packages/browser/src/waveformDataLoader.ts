/**
 * Utilities for loading audiowaveform v1/v2 binary and JSON peak files.
 */

import type { PeakData, Peaks, WaveformDataObject } from '@waveform-playlist/core';
import {
  parseAudiowaveformBinary,
  parseAudiowaveformJson,
  type PeakStore,
} from '@waveform-playlist/webaudio-peaks';

export async function loadWaveformData(src: string): Promise<PeakStore> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch waveform data: ${response.statusText}`);
  }

  const { pathname } = new URL(src, globalThis.location?.href ?? 'http://localhost');
  if (pathname.toLowerCase().endsWith('.dat')) {
    return parseAudiowaveformBinary(await response.arrayBuffer());
  }
  return parseAudiowaveformJson(await response.json());
}

export function waveformDataToPeaks(
  waveformData: WaveformDataObject,
  channelIndex: number = 0
): { data: Int8Array | Int16Array; bits: 8 | 16; length: number; sampleRate: number } {
  const channel = waveformData.channel(channelIndex);
  const bits = waveformData.bits as 8 | 16;
  const minArray = channel.min_array();
  const maxArray = channel.max_array();
  const length = minArray.length;
  const peaks = bits === 8 ? new Int8Array(length * 2) : new Int16Array(length * 2);

  for (let i = 0; i < length; i++) {
    peaks[i * 2] = minArray[i];
    peaks[i * 2 + 1] = maxArray[i];
  }

  return { data: peaks, bits, length, sampleRate: waveformData.sample_rate };
}

export async function loadPeaksFromWaveformData(
  src: string,
  channelIndex: number = 0
): Promise<{ data: Int8Array | Int16Array; bits: 8 | 16; length: number; sampleRate: number }> {
  return waveformDataToPeaks(await loadWaveformData(src), channelIndex);
}

export async function getWaveformDataMetadata(src: string): Promise<{
  sampleRate: number;
  channels: number;
  duration: number;
  samplesPerPixel: number;
  length: number;
  bits: 8 | 16;
}> {
  const waveformData = await loadWaveformData(src);
  return {
    sampleRate: waveformData.sample_rate,
    channels: waveformData.channels,
    duration: waveformData.duration,
    samplesPerPixel: waveformData.scale,
    length: waveformData.length,
    bits: waveformData.bits,
  };
}

function sliceAndResample(
  waveformData: WaveformDataObject,
  samplesPerPixel: number,
  offsetSamples?: number,
  durationSamples?: number
): WaveformDataObject | null {
  let processedData = waveformData;

  if (offsetSamples !== undefined && durationSamples !== undefined) {
    if (processedData.scale !== samplesPerPixel) {
      const ratio = samplesPerPixel / waveformData.scale;
      const targetStart = Math.floor(offsetSamples / samplesPerPixel);
      const targetEnd = Math.ceil((offsetSamples + durationSamples) / samplesPerPixel);
      const sourceStart = Math.floor(targetStart * ratio);
      const sourceEnd = Math.min(waveformData.length, Math.ceil(targetEnd * ratio));
      if (sourceStart >= sourceEnd) return null;

      processedData = processedData.slice({ startIndex: sourceStart, endIndex: sourceEnd });
      processedData = processedData.resample({ scale: samplesPerPixel });
    } else {
      const startIndex = Math.floor(offsetSamples / samplesPerPixel);
      const endIndex = Math.min(
        waveformData.length,
        Math.ceil((offsetSamples + durationSamples) / samplesPerPixel)
      );
      if (startIndex >= endIndex) return null;
      processedData = processedData.slice({ startIndex, endIndex });
    }
  } else if (processedData.scale !== samplesPerPixel) {
    processedData = processedData.resample({ scale: samplesPerPixel });
  }

  return processedData;
}

export function extractPeaksFromWaveformData(
  waveformData: WaveformDataObject,
  samplesPerPixel: number,
  channelIndex: number = 0,
  offsetSamples?: number,
  durationSamples?: number
): { data: Int8Array | Int16Array; bits: 8 | 16; length: number } {
  const processedData = sliceAndResample(
    waveformData,
    samplesPerPixel,
    offsetSamples,
    durationSamples
  );
  if (processedData === null) {
    const bits = waveformData.bits as 8 | 16;
    return {
      data: bits === 8 ? new Int8Array(0) : new Int16Array(0),
      bits,
      length: 0,
    };
  }

  const extracted = waveformDataToPeaks(processedData, channelIndex);
  return { data: extracted.data, bits: extracted.bits, length: extracted.length };
}

export function extractPeaksFromWaveformDataFull(
  waveformData: WaveformDataObject,
  samplesPerPixel: number,
  isMono: boolean,
  offsetSamples?: number,
  durationSamples?: number
): PeakData {
  const processedData = sliceAndResample(
    waveformData,
    samplesPerPixel,
    offsetSamples,
    durationSamples
  );
  if (processedData === null) {
    return { length: 0, data: [], bits: waveformData.bits as 8 | 16 };
  }

  const bits = processedData.bits as 8 | 16;
  const channelPeaks: Peaks[] = [];
  for (let channel = 0; channel < processedData.channels; channel++) {
    channelPeaks.push(waveformDataToPeaks(processedData, channel).data);
  }

  if (isMono && channelPeaks.length > 1) {
    const numPeaks = channelPeaks[0].length / 2;
    const monoPeaks: Peaks =
      bits === 8 ? new Int8Array(numPeaks * 2) : new Int16Array(numPeaks * 2);
    for (let i = 0; i < numPeaks; i++) {
      let min = 0;
      let max = 0;
      for (const peaks of channelPeaks) {
        min += peaks[i * 2] / channelPeaks.length;
        max += peaks[i * 2 + 1] / channelPeaks.length;
      }
      monoPeaks[i * 2] = min;
      monoPeaks[i * 2 + 1] = max;
    }
    return { length: numPeaks, data: [monoPeaks], bits };
  }

  return {
    length: channelPeaks.length === 0 ? 0 : channelPeaks[0].length / 2,
    data: channelPeaks,
    bits,
  };
}
