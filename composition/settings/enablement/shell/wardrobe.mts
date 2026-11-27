import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const load = createRequire(
  new URL(
    "../../../../capture/desktop/ui/frontend/package.json",
    import.meta.url,
  ),
);
const { chromium, expect } = load("@playwright/test");

type Browser = Awaited<ReturnType<typeof chromium.connectOverCDP>>;
type Context = ReturnType<Browser["contexts"]>[number];
type Page = ReturnType<Context["pages"]>[number];
type Session = Awaited<ReturnType<Context["newCDPSession"]>>;

export async function checkWardrobe(
  page: Page,
  session: Session,
  actions: Record<string, unknown>[],
  revokeCapability: () => void,
) {
  const wardrobe = page.getByRole("switch", { name: "Frog wardrobe" });
  await expect(wardrobe).not.toBeChecked();
  const proofPath = process.env.APPARENT_SHELL_PROOF;
  if (proofPath) {
    await wardrobe.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(proofPath, "wardrobe-before-toggle.png"),
    });
  }
  await wardrobe.press("Space");
  await expect(wardrobe).toBeChecked({ timeout: 2500 });
  await expect(wardrobe).toBeFocused();
  for (const width of [920, 640])
    for (const colorScheme of ["light", "dark"] as const) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 640 ? 620 : 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const equip = page.getByRole("button", {
        name: "Equip flowering lily pad",
      });
      const remove = page.getByRole("button", {
        name: "Remove flowering lily pad",
      });
      await equip.press("Enter");
      await expect(remove).toBeEnabled();
      await expect(remove).toBeFocused();
      await expect(page.getByText("Locked", { exact: true })).toBeVisible();
      if (proofPath) {
        await remove.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(
            proofPath,
            `wardrobe-equipped-${width}-${colorScheme}.png`,
          ),
        });
      }
      await remove.press("Enter");
      await expect(equip).toBeEnabled();
    }
  assert.deepEqual(
    actions.filter(({ wardrobe }) => wardrobe).map(({ wardrobe }) => wardrobe),
    Array.from({ length: 4 }, () => [
      { item: "lily-pad", action: "equip" },
      { item: "lily-pad", action: "remove" },
    ]).flat(),
  );
  revokeCapability();
  await wardrobe.press("Space");
  const wardrobeError = page.getByRole("alertdialog", {
    name: "Wardrobe change unconfirmed",
  });
  await expect(wardrobeError).toBeVisible();
  await wardrobeError
    .getByRole("button", { name: "Refresh wardrobe" })
    .press("Enter");
  await expect(wardrobe).toHaveCount(0);
}
