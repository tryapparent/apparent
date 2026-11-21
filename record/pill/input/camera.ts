export function openLipCamera() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 25, max: 30 },
    },
  });
}

export function recordLipCamera(stream: MediaStream) {
  return new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8",
    videoBitsPerSecond: 1_000_000,
  });
}
