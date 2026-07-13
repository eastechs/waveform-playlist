# @waveform-playlist/webaudio-peaks

Small library to extract min/max peaks from an array of audio samples or a Web Audio `AudioBuffer` — the data waveform renderers draw from. Standalone and framework-agnostic; no dependency on the rest of waveform-playlist beyond a shared types package.

## Installation

```bash
npm install @waveform-playlist/webaudio-peaks
```

## Usage

```typescript
import extractPeaksFromBuffer from '@waveform-playlist/webaudio-peaks';

// From a decoded AudioBuffer
const audioContext = new AudioContext();
const response = await fetch('/audio/track.mp3');
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

const peakData = extractPeaksFromBuffer(
  audioBuffer,
  1000, // samplesPerPixel
  true, // isMono - merge all channels into one
  0, // cueIn - start sample
  undefined, // cueOut - end sample (defaults to full length)
  16 // bits - 8 or 16
);

console.log(peakData.length); // number of peak pairs
console.log(peakData.data); // Peaks[] - one entry per channel (or one, if isMono)
console.log(peakData.bits); // 16

// From a raw Float32Array (e.g. one channel pulled from an AudioBuffer,
// or samples produced by a worker/AudioWorklet)
const channelData = audioBuffer.getChannelData(0);
const monoPeaks = extractPeaksFromBuffer(channelData, 1000);
```

For reusable zoom and trim data, create a `PeakStore` instead:

```typescript
import {
  createPeakStoreFromAudioBuffer,
  createPeakWorker,
  parseAudiowaveformBinary,
} from '@waveform-playlist/webaudio-peaks';

const store = createPeakStoreFromAudioBuffer(audioBuffer, 256, 16);
const zoomedOut = store.resample({ scale: 1024 });
const trimmed = store.sliceFrames(24000, 96000);

// Worker input buffers are transferred rather than cloned.
const worker = createPeakWorker();
const generated = await worker.generate({
  id: crypto.randomUUID(),
  channels: [audioBuffer.getChannelData(0).slice().buffer],
  sourceFrameCount: audioBuffer.length,
  sampleRate: audioBuffer.sampleRate,
  samplesPerPixel: 256,
  bits: 16,
  splitChannels: true,
});
worker.terminate();

const precomputed = parseAudiowaveformBinary(await fetch('/peaks.dat').then((r) => r.arrayBuffer()));
```

## API

### `extractPeaksFromBuffer(source, samplesPerPixel?, isMono?, cueIn?, cueOut?, bits?)`

Default export. Extracts peaks from an `AudioBuffer` or a `Float32Array`.

```typescript
function extractPeaksFromBuffer(
  source: AudioBuffer | Float32Array,
  samplesPerPixel?: number, // samples per peak pair (default: 1000)
  isMono?: boolean, // merge multi-channel input to mono (default: true)
  cueIn?: number, // start sample index (default: 0)
  cueOut?: number, // end sample index (default: source.length)
  bits?: 8 | 16 // peak bit depth (default: 16)
): PeakData;
```

- **`source`** — an `AudioBuffer` (all channels are read via `getChannelData`) or a single `Float32Array` of samples.
- **`samplesPerPixel`** — how many source samples are collapsed into one min/max peak pair. Higher values produce fewer, coarser peaks (typical for zoomed-out views); lower values produce more detail.
- **`isMono`** — when `true` and the source has multiple channels, all channels are averaged down to a single merged peak channel. When `false`, each channel's peaks are kept separate.
- **`cueIn` / `cueOut`** — restrict extraction to a sample range within the source, useful for extracting peaks from a trimmed region without decoding a new buffer.
- **`bits`** — `8` or `16`. Throws if any other value is passed. Peak values are quantized to `Int8Array` or `Int16Array` accordingly, which keeps pre-computed peaks compact to store or transmit.

Throws an `Error` if `bits` is not `8` or `16`.

### Return value: `PeakData`

```typescript
interface PeakData {
  length: number; // number of peak pairs (per channel)
  data: Peaks[]; // one entry per channel; each is an interleaved [min, max, min, max, ...] typed array
  bits: Bits; // 8 or 16 — the bit depth used to quantize the values
}

type Peaks = Int8Array | Int16Array;
type Bits = 8 | 16;
```

### `PeakStore`

`PeakStore` owns defensive copies of per-channel `Int8Array` or `Int16Array`
min/max pairs and records the source sample rate, exact source frame count,
samples per pixel, bit depth, and frame range represented by a view.

- `resample({ scale })` creates a coarser store using min-of-mins and
  max-of-maxes. Finer resampling is rejected because discarded source detail
  cannot be reconstructed.
- `sliceFrames(startFrame, endFrame)` creates a non-destructive frame-based
  view. Unaligned boundaries retain every source bin that overlaps the view.
- `slice()` and `channel()` preserve structural compatibility with the
  `WaveformDataObject` accepted by waveform-playlist.
- `copyChannelData()` and `toPeakData()` return defensive copies.

### Audiowaveform parsing

`parseAudiowaveformBinary()` and `parseAudiowaveformJson()` parse validated
audiowaveform v1/v2 data without a runtime parser dependency. Invalid versions,
headers, lengths, bit depths, channel counts, value ranges, and min/max pairs
are rejected before a `PeakStore` is constructed.

### Transferable worker

`createPeakWorker()` creates a Blob-backed worker for base-resolution peak
extraction. Channel `ArrayBuffer`s are transferred into the worker and peak
buffers are transferred back. Requests have stable IDs, may be cancelled
individually, reject on worker crashes, and expose `isTerminated()` so a caller
can replace a failed worker. `terminate()` rejects all pending work.

`Peaks`, `Bits`, and `PeakData` are re-exported from `@waveform-playlist/core` for convenience — you don't need to install `core` separately just to reference these types.

### Lower-level helpers

The min/max extraction and quantization primitives that `extractPeaksFromBuffer` is built from are also exported directly, for callers assembling their own pipeline (e.g. inside an `AudioWorklet` or a Web Worker where you already have raw channel data):

```typescript
import { extractPeaks, makeMono, findMinMax, convert, makeTypedArray } from '@waveform-playlist/webaudio-peaks';

// Extract peaks for a single channel you already have as a Float32Array
const channelPeaks = extractPeaks(channelData, 1000, 16);

// Merge several per-channel Peaks arrays into one mono Peaks array
const [mono] = makeMono([leftPeaks, rightPeaks], 16);
```

- `extractPeaks(channel: Float32Array, samplesPerPixel: number, bits: Bits): Peaks` — extracts interleaved min/max peaks from a single channel.
- `makeMono(channelPeaks: Peaks[], bits: Bits): Peaks[]` — averages multiple channels' peaks into a single-entry array.
- `findMinMax(array: Float32Array): { min: number; max: number }` — plain min/max over a typed array segment.
- `convert(n: number, bits: Bits): number` — quantizes a float peak value (-1..1) to the integer range for the given bit depth.
- `makeTypedArray(bits: Bits, length: number): Peaks` — allocates an `Int8Array` or `Int16Array`.

## Examples & Documentation

Guides and full API reference: [naomiaro.github.io/waveform-playlist](https://naomiaro.github.io/waveform-playlist/)

## License

MIT

Implementation provenance is documented in [PROVENANCE.md](PROVENANCE.md).
