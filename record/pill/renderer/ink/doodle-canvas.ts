import policy from "./doodle-ink.mjs";
import glyphs from "./doodles.json";

type Point = { x: number; y: number; distance: number };
type Mark = {
  strokes: Point[][];
  length: number;
  drawn: number;
  born: number;
  pressure: number;
  offset: number;
  span: number;
};

export function mountDoodles(canvas: HTMLCanvasElement, reduced: boolean) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const forcedColors = matchMedia("(forced-colors: active)");
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let edge = 8;
  let travel = 0;
  let seed = crypto.getRandomValues(new Uint32Array(1))[0];
  let previous = glyphs.length;
  let marks: Mark[] = [];
  let current: Mark | undefined;
  let frame = 0;
  let lastPaint = 0;

  function nextMark(now: number, pressure: number): Mark {
    const pose = policy.next_mark(seed, glyphs.length, previous);
    seed = pose.seed;
    previous = pose.glyph;
    const angle = (pose.turn - 50) / 175;
    const scale = 0.76 + pose.size / 248;
    const cos = Math.cos(angle) * scale;
    const sin = Math.sin(angle) * scale;
    const y =
      height > 80
        ? 24 + (pose.height * (height - 48)) / 100
        : height / 2 + (pose.height - 50) / 5;
    let left = Infinity;
    let right = -Infinity;
    let length = 0;
    const strokes = glyphs[pose.glyph].strokes.map((stroke) => {
      let last: Point | undefined;
      return stroke.split(" ").map((pair) => {
        const [u, v] = pair.split(",").map(Number);
        const x = u * cos - v * sin;
        const point = { x, y: y + u * sin + v * cos, distance: length };
        if (last) length += Math.hypot(x - last.x, point.y - last.y);
        point.distance = length;
        last = point;
        left = Math.min(x, left);
        right = Math.max(x, right);
        return point;
      });
    });
    const span = right - left;
    if (edge + span > width - 8) edge = 8;
    for (const stroke of strokes) {
      for (const point of stroke) point.x += edge - left;
    }
    edge += span + 3;
    return {
      strokes,
      length,
      drawn: 0,
      born: now,
      pressure,
      offset: travel,
      span: span + 3,
    };
  }

  function paint(now: number) {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    if (forcedColors.matches) return;
    context.strokeStyle = scheme.matches ? "#b493e1" : "#7f5daa";
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const mark of marks) {
      const age = policy.ink_age(
        Math.round(now - mark.born),
        Math.max(0, Math.round(travel - mark.offset)),
        Math.max(1, Math.round(width - 48)),
      );
      context.globalAlpha = policy.ink_alpha(age, mark.pressure) / 1000;
      context.lineWidth = 1.7 + mark.pressure / 85;
      context.beginPath();
      for (const stroke of mark.strokes) {
        const first = stroke[0];
        if (first.distance >= mark.drawn) break;
        context.moveTo(first.x, first.y);
        let last = first;
        for (let index = 1; index < stroke.length; index++) {
          const point = stroke[index];
          if (point.distance > mark.drawn) {
            const fraction =
              (mark.drawn - last.distance) / (point.distance - last.distance);
            context.lineTo(
              last.x + (point.x - last.x) * fraction,
              last.y + (point.y - last.y) * fraction,
            );
            break;
          }
          context.lineTo(point.x, point.y);
          last = point;
        }
      }
      context.stroke();
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const scale = devicePixelRatio;
    if (
      width === bounds.width &&
      height === bounds.height &&
      pixelRatio === scale
    )
      return;
    width = bounds.width;
    height = bounds.height;
    pixelRatio = scale;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context?.setTransform(scale, 0, 0, scale, 0, 0);
    edge = 8;
    travel = 0;
    current = undefined;
    marks = [];
    if (reduced && width > 20) {
      for (let i = 0; i < Math.max(1, Math.floor(width / 72)); i++) {
        const mark = nextMark(0, 16);
        mark.drawn = mark.length;
        marks.push(mark);
        edge = (i + 1) * 72 + 8;
      }
      paint(0);
    }
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (lastPaint && now - lastPaint < 1000 / 30 - 0.5) return;
    const elapsed = lastPaint ? Math.min(now - lastPaint, 100) : 0;
    lastPaint = now;
    if (!width || !height || forcedColors.matches || document.hidden) return;
    const active = now - Number(canvas.dataset.receivedAt) < 300;
    const pressure = policy.ink_level(
      Math.round(Number(canvas.dataset.sample) * 1000),
      active,
    );
    if (!current) {
      current = nextMark(now, pressure);
      marks.push(current);
    }
    current.drawn = Math.min(
      current.length,
      current.drawn + (policy.ink_speed(pressure) * elapsed) / 1000,
    );
    current.pressure = pressure;
    travel = current.offset + (current.span * current.drawn) / current.length;
    marks = marks.filter((mark) => now - mark.born < 6500 || mark === current);
    if (current.drawn >= current.length) current = undefined;
    paint(now);
  }

  const repaint = () => {
    if (reduced) paint(0);
    else if (forcedColors.matches) context.clearRect(0, 0, width, height);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  forcedColors.addEventListener("change", repaint);
  scheme.addEventListener("change", repaint);
  if (!reduced) frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    forcedColors.removeEventListener("change", repaint);
    scheme.removeEventListener("change", repaint);
  };
}
