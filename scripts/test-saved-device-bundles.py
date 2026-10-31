#!/usr/bin/env python3
"""Exercise retired device archives without a device, display, clipboard or network.

Usage: python3 scripts/test-saved-device-bundles.py /absolute/apparent /fresh/evidence-dir
Requires the repository's Linux movie decoder and FFmpeg. No tests are silently skipped.
The evidence directory must not exist. Only synthetic files are created there.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

binary = Path(sys.argv[1]).resolve()
root = Path(sys.argv[2]).resolve()
root.mkdir(parents=True, exist_ok=False)


def run(*args):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, timeout=120)
    with (root / "commands.log").open("a") as log:
        log.write(f"{args!r}\nexit={result.returncode}\n{result.stdout}\n{result.stderr}\n")
    assert result.returncode == 0, f"{args!r}: {result.stderr}"
    return result


def hashes(folder):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.iterdir()) if p.is_file()}


results = []
for kind in ["mirror", "apparentkit"]:
    source = root / f"saved-{kind}.apparent"
    source.mkdir()
    run("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=240x400:r=8:d=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source / "recording.mov")
    manifest = {
        "version": 1, "id": f"synthetic-{kind}", "createdAtMs": 1793000000000,
        "durationMs": 2250,
        "target": {"mode": "device", "app": "Archive fixture", "displayId": 0,
                   "frame": {"x": 0, "y": 0, "width": 240, "height": 400, "scale": 1}},
        "source": "iphone", "device": {"name": "Synthetic device", "capture": kind,
            "id": "synthetic", "model": "fixture", "system": "historical",
            "width": 240, "height": 400, "screen": [120, 200, 2],
            "app": "test.example", "appVersion": "7", "appShortVersion": "1.0"},
        "video": "recording.mov", "videoOffsetMs": 250,
        "transcript": {"source": "synthetic", "text": "", "segments": []},
        "interactionTelemetry": "videoOnly",
        "strokes": [{"t0": 1200, "t1": 1450, "fw": 240, "fh": 400,
                     "on": "Synthetic mark", "pin": 1, "pts": [2500, 2500, 0, 2500, 2500, 250]}],
        "marks": [], "events": [
            {"kind": "click", "t": 750, "x": 0.5, "y": 0.5, "label": "Synthetic button"},
            {"kind": "app_event", "t": 900, "label": "Historical event"}],
        "keyframes": [], "contactSheet": "contact-sheet.png",
        "context": {"workspace": "synthetic"},
        "contextChanges": [{"t": 700, "key": "workspace", "value": "changed"}],
        "screens": [{"t0": 0, "t1": 2250, "name": "Archive screen"}]
    }
    (source / "apparent.json").write_text(json.dumps(manifest, indent=2) + "\n")
    original = hashes(source)
    inspected = run(binary, "inspect", source)
    assert "Synthetic device" in inspected.stdout or "device" in inspected.stdout.lower()
    output = root / f"rebuilt-{kind}.apparent"
    run(binary, "reprocess", source, "--out", output)
    saved = json.loads((output / "apparent.json").read_text())
    for key in ["target", "source", "device", "context", "contextChanges", "screens", "events", "strokes", "interactionTelemetry", "videoOffsetMs", "durationMs"]:
        assert saved[key] == manifest[key], f"{kind} changed {key}: {saved.get(key)!r} != {manifest[key]!r}"
    assert saved["keyframes"], "reprocess must decode real movie frames"
    assert all(k["t"] >= 250 for k in saved["keyframes"]), "keyframes must use the bundle clock"
    with wave.open(str(output / "audio.wav")) as wav:
        assert wav.getframerate() == 16000 and wav.getnchannels() == 1
        assert wav.readframes(4000) == bytes(8000), "saved audio must use the bundle clock"
    run(binary, "zoom", output, "--at", "0.75")
    exported = root / f"export-{kind}.mp4"
    run(binary, "export", output, "--out", exported, "--crop", "full", "--fps", "8")
    probe = json.loads(run("ffprobe", "-v", "error", "-show_streams", "-of", "json", exported).stdout)
    assert any(s["codec_type"] == "audio" for s in probe["streams"]), "saved movie audio must survive export"
    assert any(s["codec_type"] == "video" and s["width"] == 240 and s["height"] == 400 for s in probe["streams"])
    assert hashes(source) == original, "inspect/reprocess/export changed the source archive"
    results.append({"capture": kind, "sourceHashes": original, "sourceUnchanged": True,
                    "keyframeCount": len(saved["keyframes"]), "retainedMetadata": [
                        "target", "source", "device", "context", "contextChanges", "screens", "events", "strokes", "interactionTelemetry", "videoOffsetMs", "durationMs"],
                    "export": str(exported), "rebuilt": str(output)})

run(binary, "demo", "--out", root / "synthetic-desktop.apparent")
(root / "results.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
