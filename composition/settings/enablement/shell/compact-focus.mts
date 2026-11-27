import { createRequire } from "node:module";
import type { TestContext } from "node:test";

const load = createRequire(
  new URL(
    "../../../../capture/desktop/ui/frontend/package.json",
    import.meta.url,
  ),
);
const { expect } = load("@playwright/test");

type Locator = {
  count(): Promise<number>;
  focus(): Promise<void>;
  last(): Locator;
  locator(selector: string): Locator;
  evaluateAll<T>(read: (elements: Element[]) => T): Promise<T>;
};

export async function checkCompactFocus(
  t: TestContext,
  main: Locator,
  nav: Locator,
  pane: string,
  theme: "light" | "dark",
) {
  async function check(target: Locator, control: string) {
    try {
      await target.focus();
      await expect(target).toBeInViewport();
      await expect(target).toBeFocused();
    } catch (error) {
      const geometry = await target
        .evaluateAll(([element]: Element[]) => {
          const identify = (el: Element | null) =>
            el && {
              tag: el.localName,
              id: el.id || undefined,
              label: el.getAttribute("aria-label") || undefined,
            };
          const bounds = (el: Element) => {
            const { x, y, width, height } = el.getBoundingClientRect();
            return { x, y, width, height };
          };
          const scroll = (el: Element | null) =>
            el && {
              top: el.scrollTop,
              left: el.scrollLeft,
              height: el.scrollHeight,
              clientHeight: el.clientHeight,
              bounds: bounds(el),
            };
          return {
            title: document.title,
            viewport: { width: innerWidth, height: innerHeight },
            active: identify(document.activeElement),
            target: element
              ? {
                  ...identify(element),
                  focused: element === document.activeElement,
                  bounds: bounds(element),
                }
              : null,
            scroll: {
              document: scroll(document.scrollingElement),
              shell: scroll(document.querySelector(".settings-shell")),
              main: scroll(document.querySelector("main")),
              sidebar: scroll(document.querySelector(".settings-sidebar")),
            },
          };
        })
        .catch(() => null);
      t.diagnostic(
        `Compact focus ${JSON.stringify({
          pane,
          theme,
          control,
          viewport: { width: 320, height: 265 },
          geometry,
        })}`,
      );
      throw error;
    }
  }

  const last = main
    .locator("button:enabled:visible,select:enabled:visible,a[href]:visible")
    .last();
  if (await last.count()) await check(last, "last pane control");
  await check(nav, "page navigation");
}
