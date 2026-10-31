# Synthetic publication fixture

`tiny.mp4` is a two-frame blue 16×16 H.264 movie (0.2 seconds, no audio).
It contains no capture or user data. Generated offline with:

```
ffmpeg -nostdin -v error -f lavfi -i color=c=blue:s=16x16:r=10:d=0.2 \
  -an -c:v libx264 -threads 1 -pix_fmt yuv420p -movflags +faststart tiny.mp4
```

FFprobe reported H.264, 16×16, two frames, duration 0.200000, size 1592.
SHA-256: `1b384568b3ba22e9aea619a2a086e2b20af22f3d791ea17b8dc228fc0e1988fe`.
Tests generate real PNG/WAV bytes through the existing production encoders.
No fixture generation tool is needed to run the tests.
