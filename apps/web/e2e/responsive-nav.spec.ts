import { expect, test } from "@playwright/test";

// Narrow phones (320px, 375px) and tablet (768px) must not scroll sideways, and
// the navigation must switch between the menu button and the inline links at
// the md breakpoint (768px).

const PAGES = ["/", "/marketplace"];
const PHONE_WIDTHS = [320, 375];
const TABLET_WIDTH = 768;

for (const path of PAGES) {
  for (const width of PHONE_WIDTHS) {
    test(`no horizontal overflow on ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`mobile menu opens and closes on ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const toggle = page.getByRole("button", { name: "Open navigation menu" });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");

      await toggle.click();
      await expect(page.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Close navigation menu" })).toBeVisible();
    });
  }

  test(`tablet layout switches to inline navigation on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: TABLET_WIDTH, height: 900 });
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
