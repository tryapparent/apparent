export type PillView = {
  transcript?: import("../../transcription/src/policy").Preview | null;
  revision: number;
  phase: "hidden" | "selecting" | "recording" | "processing" | "completed";
  clock: string;
  label: string;
  warning: string | null;
  notice: string | null;
  noteTip?: string | null;
  reducedMotion: boolean;
  draggable: boolean;
  inputWaveform: number[] | null;
  softBloom?: boolean | null;
  doodleInk?: boolean | null;
  noteCount: number;
  shareIndicator?: import("../presentation").ShareIndicator;
  actions: {
    id: string;
    label: string;
    enabled: boolean;
    selected: boolean;
    primary: boolean;
  }[];
};
