import assert from "node:assert/strict";

export const now = () => Number(process.hrtime.bigint()) / 1e6;

export type RendererPage = {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<A, R>(fn: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
};

export async function calibrate(page: RendererPage) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const begin = now();
    const renderer = await page.evaluate(() => performance.now());
    const end = now();
    samples.push({ low: begin - renderer, high: end - renderer });
  }
  const low = Math.max(...samples.map((sample) => sample.low));
  const high = Math.min(...samples.map((sample) => sample.high));
  assert.ok(high >= low, "Renderer clock bounds disagree");
  return { low, high };
}

export async function arm(
  page: RendererPage,
  source: string,
  endpoint: string,
) {
  await page.evaluate(
    ({ source, endpoint }) => {
      const state = { input: 0, dom: 0, visible: 0, presented: 0 };
      let finish!: () => void;
      const presentation = new Promise<void>((resolve) => {
        finish = resolve;
      });
      Object.defineProperty(window, "__apparentHandoffWitness", {
        value: { state, presentation },
        configurable: true,
      });
      function visible(element: HTMLElement) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          style.visibility !== "visible" ||
          style.display === "none" ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.right <= 0 ||
          rect.left >= innerWidth ||
          rect.bottom <= 0 ||
          rect.top >= innerHeight ||
          element.matches(":disabled,[aria-disabled=true]")
        )
          return false;
        if (element.getAttribute("role") !== "option") return true;
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return element.contains(hit);
      }
      const find = () => document.querySelector<HTMLElement>(endpoint);
      if (find() && visible(find()!)) throw Error("Endpoint already visible");
      let probeScheduled = false;
      function observe() {
        if (!state.input || state.visible) return;
        const element = find();
        if (!element) return;
        state.dom ||= performance.now();
        if (!visible(element)) {
          if (!probeScheduled) {
            probeScheduled = true;
            requestAnimationFrame(() => {
              probeScheduled = false;
              observe();
            });
          }
          return;
        }
        state.visible = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (element.isConnected && visible(element)) {
              state.presented = performance.now();
              observer.disconnect();
              window.removeEventListener("resize", observe);
              finish();
            } else {
              state.visible = 0;
              observe();
            }
          }),
        );
      }
      const observer = new MutationObserver(observe);
      window.addEventListener("resize", observe);
      document.addEventListener(
        "click",
        function capture(event) {
          if (
            !event.isTrusted ||
            !(event.target instanceof Element) ||
            !event.target.closest(source)
          )
            return;
          state.input = performance.now();
          document.removeEventListener("click", capture, true);
        },
        true,
      );
      observer.observe(document.body, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    },
    { source, endpoint },
  );
}

export async function witness(page: RendererPage) {
  return page.evaluate(async () => {
    const result = Reflect.get(window, "__apparentHandoffWitness") as {
      state: { input: number; dom: number; visible: number; presented: number };
      presentation: Promise<void>;
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Handoff endpoint was not presented")),
        10_000,
      );
      void result.presentation.then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return result.state;
  });
}
