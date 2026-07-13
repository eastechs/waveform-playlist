import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeakWorker } from '../index';

class FakeWorker {
  static latest: FakeWorker;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;

  constructor(readonly url: string) {
    FakeWorker.latest = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(message: string): void {
    this.onerror?.({ message, error: new Error(message) } as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: null } as MessageEvent);
  }
}

describe('createPeakWorker', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:peaks');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('transfers channel buffers and reconstructs immutable peak data', async () => {
    const api = createPeakWorker();
    const channel = new Float32Array([-1, 1]).buffer;
    const result = api.generate({
      id: 'one',
      channels: [channel],
      sourceFrameCount: 2,
      sampleRate: 48000,
      samplesPerPixel: 2,
      bits: 16,
      splitChannels: true,
    });

    expect(FakeWorker.latest.url).toBe('blob:peaks');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:peaks');
    expect(FakeWorker.latest.messages[0].transfer).toEqual([channel]);

    const peaks = new Int16Array([-32768, 32767]);
    FakeWorker.latest.emitMessage({
      id: 'one',
      sampleRate: 48000,
      sourceFrameCount: 2,
      samplesPerPixel: 2,
      bits: 16,
      data: [peaks.buffer],
    });

    const store = await result;
    peaks.fill(0);
    expect(Array.from(store.copyChannelData(0))).toEqual([-32768, 32767]);
  });

  it('cancels one request without terminating the worker', async () => {
    const api = createPeakWorker();
    const result = api.generate({
      id: 'cancel-me',
      channels: [new Float32Array(1024).buffer],
      sourceFrameCount: 1024,
      sampleRate: 48000,
      samplesPerPixel: 16,
      bits: 8,
      splitChannels: true,
    });
    api.cancel('cancel-me');

    await expect(result).rejects.toThrow('cancelled');
    expect(api.isTerminated()).toBe(false);
    expect(FakeWorker.latest.messages[1].message).toEqual({ type: 'cancel', id: 'cancel-me' });
  });

  it('rejects pending work after a crash and reports termination for recovery', async () => {
    const api = createPeakWorker();
    const result = api.generate({
      id: 'crash',
      channels: [new Float32Array(1).buffer],
      sourceFrameCount: 1,
      sampleRate: 48000,
      samplesPerPixel: 1,
      bits: 16,
      splitChannels: true,
    });
    FakeWorker.latest.emitError('worker crashed');

    await expect(result).rejects.toThrow('worker crashed');
    expect(api.isTerminated()).toBe(true);
    expect(FakeWorker.latest.terminated).toBe(true);
    await expect(
      api.generate({
        id: 'later',
        channels: [new Float32Array(1).buffer],
        sourceFrameCount: 1,
        sampleRate: 48000,
        samplesPerPixel: 1,
        bits: 16,
        splitChannels: true,
      })
    ).rejects.toThrow('terminated');
  });

  it('terminates and rejects all pending work', async () => {
    const api = createPeakWorker();
    const result = api.generate({
      id: 'pending',
      channels: [new Float32Array(1).buffer],
      sourceFrameCount: 1,
      sampleRate: 48000,
      samplesPerPixel: 1,
      bits: 16,
      splitChannels: true,
    });
    api.terminate();

    await expect(result).rejects.toThrow('terminated');
    expect(FakeWorker.latest.terminated).toBe(true);
  });

  it('rejects malformed typed-array results instead of leaving work pending', async () => {
    const api = createPeakWorker();
    const result = api.generate({
      id: 'malformed',
      channels: [new Float32Array(1).buffer],
      sourceFrameCount: 1,
      sampleRate: 48000,
      samplesPerPixel: 1,
      bits: 16,
      splitChannels: true,
    });
    FakeWorker.latest.emitMessage({
      id: 'malformed',
      sampleRate: 48000,
      sourceFrameCount: 1,
      samplesPerPixel: 1,
      bits: 16,
      data: [new ArrayBuffer(1)],
    });

    await expect(result).rejects.toThrow();
  });

  it('terminates after a worker message decoding error', async () => {
    const api = createPeakWorker();
    const result = api.generate({
      id: 'message-error',
      channels: [new Float32Array(1).buffer],
      sourceFrameCount: 1,
      sampleRate: 48000,
      samplesPerPixel: 1,
      bits: 16,
      splitChannels: true,
    });
    FakeWorker.latest.emitMessageError();

    await expect(result).rejects.toThrow('decoded');
    expect(api.isTerminated()).toBe(true);
  });
});
