# Permissive peak pipeline design

## Goal

Remove `waveform-data` and the derived embedded worker from the React browser
package while preserving generated peaks, zoom resampling, frame-based trim
views, and audiowaveform precomputed-file compatibility.

## Design

`@waveform-playlist/webaudio-peaks` owns a typed-array-backed `PeakStore` with a
structural `WaveformDataObject` surface. It records exact source metadata,
creates defensive copies at public boundaries, resamples only to coarser
scales, and retains all overlapping source bins for unaligned slices.

The same package owns fail-closed audiowaveform v1/v2 binary and JSON parsers.
The browser package loads those stores through its existing precomputed-loader
API and uses one cancellable transferable worker for decoded `AudioBuffer`
channels. A worker crash terminates that instance so the existing cache hook
can replace it.

`ui-components` has no parser dependency. The separate dawcore worker is not in
the browser artifact scope and remains a follow-up before an upstream PR.

## Security and resource boundaries

- Parser dimensions use safe-integer multiplication and exact byte-length
  checks before allocation or iteration.
- Parsed signed values and min/max ordering are validated before construction.
- Worker inputs are transferred copies of decoded channel data, never the live
  `AudioBuffer` views.
- Cancellation removes pending ownership; termination and crashes reject every
  waiter and release the worker.
- Consumers must allow `worker-src blob:` in CSP before enabling the worker.
