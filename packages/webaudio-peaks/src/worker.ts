import type { Bits, Peaks } from '@waveform-playlist/core';
import { PeakStore } from './peakStore';

export interface PeakWorkerRequest {
  id: string;
  channels: ArrayBuffer[];
  sourceFrameCount: number;
  sampleRate: number;
  samplesPerPixel: number;
  bits: Bits;
  splitChannels: boolean;
}

export interface PeakWorkerApi {
  generate(request: PeakWorkerRequest): Promise<PeakStore>;
  cancel(id: string): void;
  isTerminated(): boolean;
  terminate(): void;
}

interface WorkerResult {
  id: string;
  sampleRate?: number;
  sourceFrameCount?: number;
  samplesPerPixel?: number;
  bits?: Bits;
  data?: ArrayBuffer[];
  error?: string;
}

interface PendingEntry {
  resolve(value: PeakStore): void;
  reject(reason: unknown): void;
}

// Independently authored from the small MIT webaudio-peaks extraction
// primitives. This contains no source from waveform-data or its worker.
const workerSource = `
"use strict";

var jobs = new Map();
var BINS_PER_TURN = 128;

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function quantize(value, bits) {
  var negativeScale = bits === 8 ? 128 : 32768;
  var positiveScale = bits === 8 ? 127 : 32767;
  var minimum = -negativeScale;
  var maximum = positiveScale;
  var scaled = value < 0 ? value * negativeScale : value * positiveScale;
  return Math.max(minimum, Math.min(maximum, Math.trunc(scaled)));
}

function fail(id, error) {
  self.postMessage({ id: id, error: error && error.message ? error.message : String(error) });
}

function finish(job) {
  jobs.delete(job.id);
  var buffers = job.output.map(function(channel) { return channel.buffer; });
  self.postMessage({
    id: job.id,
    sampleRate: job.sampleRate,
    sourceFrameCount: job.sourceFrameCount,
    samplesPerPixel: job.samplesPerPixel,
    bits: job.bits,
    data: buffers
  }, buffers);
}

function processTurn(id) {
  var job = jobs.get(id);
  if (!job) return;

  try {
    var endBin = Math.min(job.binCount, job.nextBin + BINS_PER_TURN);
    for (; job.nextBin < endBin; job.nextBin++) {
      var startFrame = job.nextBin * job.samplesPerPixel;
      var endFrame = Math.min(job.sourceFrameCount, startFrame + job.samplesPerPixel);

      if (job.splitChannels) {
        for (var channelIndex = 0; channelIndex < job.channels.length; channelIndex++) {
          var channel = job.channels[channelIndex];
          var min = Infinity;
          var max = -Infinity;
          for (var frame = startFrame; frame < endFrame; frame++) {
            var sample = channel[frame];
            if (sample < min) min = sample;
            if (sample > max) max = sample;
          }
          job.output[channelIndex][job.nextBin * 2] = quantize(min === Infinity ? 0 : min, job.bits);
          job.output[channelIndex][job.nextBin * 2 + 1] = quantize(max === -Infinity ? 0 : max, job.bits);
        }
      } else {
        var monoMin = Infinity;
        var monoMax = -Infinity;
        for (var monoFrame = startFrame; monoFrame < endFrame; monoFrame++) {
          var sum = 0;
          for (var inputChannel = 0; inputChannel < job.channels.length; inputChannel++) {
            sum += job.channels[inputChannel][monoFrame];
          }
          var monoSample = sum / job.channels.length;
          if (monoSample < monoMin) monoMin = monoSample;
          if (monoSample > monoMax) monoMax = monoSample;
        }
        job.output[0][job.nextBin * 2] = quantize(monoMin === Infinity ? 0 : monoMin, job.bits);
        job.output[0][job.nextBin * 2 + 1] = quantize(monoMax === -Infinity ? 0 : monoMax, job.bits);
      }
    }

    if (job.nextBin === job.binCount) finish(job);
    else setTimeout(function() { processTurn(id); }, 0);
  } catch (error) {
    jobs.delete(id);
    fail(id, error);
  }
}

function start(message) {
  if (jobs.has(message.id)) throw new Error("A peak job with this id already exists");
  if (typeof message.id !== "string" || message.id.length === 0) throw new Error("id is required");
  if (!Array.isArray(message.channels) || message.channels.length === 0) throw new Error("channels are required");
  if (!Number.isSafeInteger(message.sourceFrameCount) || message.sourceFrameCount < 0) throw new Error("sourceFrameCount is invalid");
  if (!isPositiveInteger(message.sampleRate)) throw new Error("sampleRate is invalid");
  if (!isPositiveInteger(message.samplesPerPixel)) throw new Error("samplesPerPixel is invalid");
  if (message.bits !== 8 && message.bits !== 16) throw new Error("bits is invalid");
  if (typeof message.splitChannels !== "boolean") throw new Error("splitChannels is invalid");

  var channels = message.channels.map(function(buffer) {
    if (!(buffer instanceof ArrayBuffer)) throw new Error("channel data is invalid");
    return new Float32Array(buffer);
  });
  for (var i = 0; i < channels.length; i++) {
    if (channels[i].length < message.sourceFrameCount) throw new Error("A channel is shorter than sourceFrameCount");
  }

  var binCount = Math.ceil(message.sourceFrameCount / message.samplesPerPixel);
  var outputChannels = message.splitChannels ? channels.length : 1;
  var output = Array.from({ length: outputChannels }, function() {
    return message.bits === 8 ? new Int8Array(binCount * 2) : new Int16Array(binCount * 2);
  });
  var job = {
    id: message.id,
    channels: channels,
    sourceFrameCount: message.sourceFrameCount,
    sampleRate: message.sampleRate,
    samplesPerPixel: message.samplesPerPixel,
    bits: message.bits,
    splitChannels: message.splitChannels,
    binCount: binCount,
    nextBin: 0,
    output: output
  };
  jobs.set(job.id, job);
  processTurn(job.id);
}

self.onmessage = function(event) {
  var message = event.data;
  if (message && message.type === "cancel") {
    jobs.delete(message.id);
    return;
  }
  try {
    start(message);
  } catch (error) {
    fail(message && message.id ? message.id : "", error);
  }
};
`;

function validateRequest(request: PeakWorkerRequest): void {
  if (typeof request.id !== 'string' || request.id.length === 0) {
    throw new RangeError('Peak worker request id is required');
  }
  if (!Array.isArray(request.channels) || request.channels.length === 0) {
    throw new RangeError('At least one channel is required');
  }
  if (!Number.isSafeInteger(request.sourceFrameCount) || request.sourceFrameCount < 0) {
    throw new RangeError('sourceFrameCount must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(request.sampleRate) || request.sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive safe integer');
  }
  if (!Number.isSafeInteger(request.samplesPerPixel) || request.samplesPerPixel <= 0) {
    throw new RangeError('samplesPerPixel must be a positive safe integer');
  }
  if (request.bits !== 8 && request.bits !== 16) throw new RangeError('bits must be 8 or 16');
  if (typeof request.splitChannels !== 'boolean') {
    throw new TypeError('splitChannels must be a boolean');
  }
  const byteLength = request.sourceFrameCount * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength)) {
    throw new RangeError('sourceFrameCount exceeds transferable channel limits');
  }
  if (
    request.channels.some(
      (channel) => !(channel instanceof ArrayBuffer) || channel.byteLength < byteLength
    )
  ) {
    throw new RangeError('Every channel must contain sourceFrameCount float samples');
  }
}

export function createPeakWorker(): PeakWorkerApi {
  let worker: Worker;
  try {
    const blob = new Blob([workerSource], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn('[webaudio-peaks] Failed to create peak worker:', error);
    return {
      generate: () => Promise.reject(new Error('Peak worker creation failed')),
      cancel: () => undefined,
      isTerminated: () => false,
      terminate: () => undefined,
    };
  }

  const pending = new Map<string, PendingEntry>();
  let terminated = false;

  const failWorker = (reason: unknown) => {
    if (!terminated) {
      terminated = true;
      worker.terminate();
    }
    for (const entry of pending.values()) entry.reject(reason);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const message = event.data;
    if (!message || typeof message.id !== 'string') {
      failWorker(new Error('Peak worker returned an invalid result'));
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;

    if (message.error) {
      pending.delete(message.id);
      entry.reject(new Error(message.error));
      return;
    }
    if (
      message.sampleRate === undefined ||
      message.sourceFrameCount === undefined ||
      message.samplesPerPixel === undefined ||
      message.bits === undefined ||
      message.data === undefined
    ) {
      pending.delete(message.id);
      entry.reject(new Error('Peak worker returned an incomplete result'));
      return;
    }

    try {
      const data: Peaks[] = message.data.map((buffer) =>
        message.bits === 8 ? new Int8Array(buffer) : new Int16Array(buffer)
      );
      pending.delete(message.id);
      entry.resolve(
        new PeakStore({
          sampleRate: message.sampleRate,
          sourceFrameCount: message.sourceFrameCount,
          samplesPerPixel: message.samplesPerPixel,
          bits: message.bits,
          data,
        })
      );
    } catch (error) {
      pending.delete(message.id);
      entry.reject(error);
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    failWorker(event.error ?? new Error(event.message || 'Peak worker crashed'));
  };

  worker.onmessageerror = () => {
    failWorker(new Error('Peak worker message could not be decoded'));
  };

  return {
    generate(request) {
      if (terminated) return Promise.reject(new Error('Peak worker terminated'));
      try {
        validateRequest(request);
      } catch (error) {
        return Promise.reject(error);
      }
      if (pending.has(request.id)) {
        return Promise.reject(new Error(`Peak worker request ${request.id} already exists`));
      }

      return new Promise<PeakStore>((resolve, reject) => {
        pending.set(request.id, { resolve, reject });
        try {
          worker.postMessage(request, request.channels);
        } catch (error) {
          pending.delete(request.id);
          reject(error);
        }
      });
    },

    cancel(id) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.reject(new Error('Peak generation cancelled'));
      worker.postMessage({ type: 'cancel', id });
    },

    isTerminated() {
      return terminated;
    },

    terminate() {
      if (terminated) return;
      failWorker(new Error('Peak worker terminated'));
    },
  };
}
