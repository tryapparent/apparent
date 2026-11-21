import { Button } from "@apparent/ui/button";
import type { Ref } from "react";
import "./lip-pill.css";

type Props = {
  active: boolean;
  reading: boolean;
  tail: boolean;
  text: string;
  notice: string;
  levels: number[] | null;
  video: Ref<HTMLVideoElement>;
  canvas: Ref<HTMLCanvasElement>;
  finish(): void;
  cancel(): void;
  retry(): void;
  copy(): void;
};

export function LipPill(props: Props) {
  const status = props.reading ? "Reading lips…" : props.active
    ? props.levels ? "Camera on" : "Move into frame"
    : props.notice || (props.text ? "Prompt ready" : "Opening camera…");
  return <section className="lip-pill" aria-label="Silent prompt">
    <div className="lip-pill-row">
      <span className="lip-pill-status" role="status">{status}</span>
      {props.active && props.levels && <span className="lip-pill-motion" aria-hidden="true">
        {props.levels.map((level, index) => <i key={index} style={{ height: 3 + 19 * level }} />)}
      </span>}
      {props.active && <Button onClick={props.finish} disabled={props.tail}>{props.tail ? "Finishing…" : "Finish"}</Button>}
      {props.text && <Button onClick={props.copy}>Copy prompt</Button>}
      {props.text && <Button variant="ghost" onClick={props.retry}>New prompt</Button>}
      {!props.active && !props.reading && !props.text && !!props.notice && <Button onClick={props.retry}>Try again</Button>}
      <Button variant="ghost" onClick={props.cancel}>{props.text ? "Close" : "Cancel"}</Button>
    </div>
    <video ref={props.video} className="lip-pill-camera" autoPlay muted playsInline aria-hidden="true" />
    <canvas ref={props.canvas} width={132} height={68} hidden={!props.active} aria-label="Tracked mouth preview" />
    {props.text && <p className="lip-pill-result">{props.text}</p>}
  </section>;
}
