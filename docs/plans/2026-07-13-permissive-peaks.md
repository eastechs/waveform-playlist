# Permissive peak pipeline implementation plan

1. Add `PeakStore`, extraction, coarser resampling, and frame slicing to
   `@waveform-playlist/webaudio-peaks`.
2. Add validated audiowaveform v1/v2 binary and JSON parsing.
3. Add transferable worker generation, cancellation, termination, and crash
   recovery.
4. Replace browser imports and remove `waveform-data` from browser and
   ui-components manifests.
5. Add extraction, parsing, resampling, slicing, worker lifecycle, and React
   integration tests.
6. Build and inspect exact prerelease tarballs; verify no copyleft runtime
   package enters their closure.
7. Validate the artifacts in the packaged Wavefield Electron spike.

The design and this working plan are removed before the final upstream PR, per
repository convention. Permanent provenance remains with webaudio-peaks.
