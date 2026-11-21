export type WrittenResult = "sent" | "invalid" | "unavailable" | "unconfirmed" | "attachment_unavailable";

export type CaptureResult =
  | { status: "saved"; video?: Uint8Array }
  | { status: "cancelled" | "unavailable" };

export type FeedbackBridge = {
  available(): Promise<boolean>;
  recordingAvailable(): Promise<boolean>;
  startRecording(): Promise<CaptureResult>;
  discardRecording(): Promise<void>;
  sendRecording(): Promise<WrittenResult>;
  sendWritten(description: string, id: string): Promise<WrittenResult>;
};
