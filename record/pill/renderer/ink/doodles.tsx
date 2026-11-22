import { useCallback } from "react";
import { mountDoodles } from "./doodle-canvas";

export default function Doodles({
  reduced,
  sample,
  receivedAt,
}: {
  reduced: boolean;
  sample: number;
  receivedAt: number;
}) {
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas) return mountDoodles(canvas, reduced);
    },
    [reduced],
  );
  return (
    <canvas
      ref={attach}
      className="pill-doodles"
      aria-hidden="true"
      data-sample={sample}
      data-received-at={receivedAt}
    />
  );
}
