import { useEffect, useRef, useState } from "react";
import type { LipCameraInput, LipRecordingBridge } from "../input/renderer";

export function RecordingLipPreview({ camera, load }: {
  camera: LipCameraInput;
  load: LipRecordingBridge["lipPreview"];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    const player = video.current;
    const surface = canvas.current;
    if (!player || !surface) return;

    const tracker = new AbortController();
    player.srcObject = camera.stream;
    const hide = () => { if (!tracker.signal.aborted) setTracking(false); };
    void Promise.all([import("./lip-preview"), load(camera.capture), player.play()]).then(
      async ([{ LipPreview }, { trackingModel, wasm }]) => {
        if (tracker.signal.aborted) return;
        await LipPreview.start(player, surface, trackingModel, wasm, tracker.signal,
          levels => setTracking(levels !== null), hide, false);
      },
    ).catch(hide);
    return () => {
      tracker.abort();
      player.srcObject = null;
    };
  }, [camera, load]);

  return <>
    <video ref={video} className="pill-lip-camera" muted playsInline aria-hidden="true" />
    <canvas ref={canvas} className="pill-lip-preview" width={132} height={68}
      hidden={!tracking} role="img" aria-label="Tracked mouth preview" />
  </>;
}
