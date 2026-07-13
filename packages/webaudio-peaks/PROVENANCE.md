# Peak implementation provenance

The peak store, audiowaveform parser, and transferable worker in this package
were independently authored for the Eastechs integration beginning from
`waveform-playlist@44ef64b5d1dffd6c20469eaabeb6deeb1ccea308`.

## Allowed references

- Naomi Aro's MIT-licensed `webaudio-peaks@1.0.0` and the existing typed
  extraction primitives already present in this package supplied the permitted
  min/max extraction and integer-quantization foundation.
- Audiowaveform's public binary/JSON format documentation supplied field names,
  header layout, byte order, channel interleaving, and v1/v2 compatibility
  requirements.
- Browser Web Worker, transferable `ArrayBuffer`, typed-array, and Blob URL web
  platform documentation supplied the worker lifecycle and transport contract.

## Excluded source

No code was copied, translated, or adapted from BBC's `waveform-data` package,
its waveform generator, or the prior embedded browser/dawcore peak workers. The
new worker algorithm is independently written from the permitted
`webaudio-peaks` primitives, and the parser is independently written from the
public file-format contract.

The separate `packages/dawcore` worker remains outside this package's source
and is not part of the browser integration artifact. It must be migrated before
an upstream pull request claims repository-wide removal.
