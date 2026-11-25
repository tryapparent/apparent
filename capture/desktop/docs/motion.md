# Recording pill motion

The installed pill uses the [Record presentation and policy](../../../record/pill/README.md)
on Linux and macOS. Phase changes show or hide the Electron window immediately.
The local lab plays its scenes over a backdrop with synthetic state and no
capture, microphone, global shortcuts, ingest or send.

```sh
apparent lab pill finish --repeat 1 --time-scale 0.25
```

The native pill spring presets and motion-lint trace runner were retired with
the native presenters. Use the [Electron renderer checks](../ui/electron_pill/README.md)
to inspect light and dark appearance, width, input and phase transitions.
The [native performance benchmark](../../../record/enablement/performance/README.md)
measures when the installed pill is first visible during a real recording.

Soft Bloom displays about one second of actual captured microphone
history. Engine reduces the existing 16 kHz mono PCM into 24 overlapping RMS
samples and retains the existing clipping, stale sample and warning behavior.
The renderer consumes that history with its own transport expiry. It opens no
extra stream or permission prompt. Reduce Motion uses the fixed ring and input
ticks. The preference for dragging and movie inclusion on macOS is
`experiments.movableRecordingControls`. When disabled, during capture the pill
waits for the screen worker's window exclusion acknowledgement before it maps.
