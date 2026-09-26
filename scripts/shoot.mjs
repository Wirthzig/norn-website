// screenshots of the intro and every page, desktop and phone, in a headless browser.
// run against the dev server, the frozen intro frames need it:
//   npx vite --port 5610 &
//   npm run shoot -- http://127.0.0.1:5610/norn-website/
// frames land in shots/, which is gitignored. fails on any page error.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5610/norn-website/";
const frames = [400, 1800, 1990, 2020, 2045, 2075, 2110, 2150, 2200, 2260, 2340, 2450, 2600, 2900, 3900];
const out = "shots";
mkdirSync(out, { recursive: true });

// the chrome headless shell playwright already cached, so nothing is downloaded
function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  const shells = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort() : [];
  for (const shell of shells.reverse()) {
    for (const platform of readdirSync(join(cache, shell))) {
      const candidate = join(cache, shell, platform, "chrome-headless-shell");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("no chromium found, set CHROMIUM_PATH");
}

const browser = await chromium.launch({ executablePath: browserPath() });
const failures = [];
const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

for (const [name, viewport] of Object.entries(viewports)) {
  const { width, height, ...rest } = viewport;
  const context = await browser.newContext({ viewport: { width, height }, ...rest });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`${name} ${page.url()} ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${name} ${page.url()} ${message.text()}`);
  });

  for (const at of frames) {
    await page.goto(`${base}?at=${at || 1}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}-intro-${String(at).padStart(4, "0")}.png` });
  }

  // arriving from inside the site, the finished page
  await page.goto(base, { referer: base });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}-home-hero.png` });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-home-full.png`, fullPage: true });

  // the legal links scroll down the same page
  for (const name of ["Impressum", "Datenschutz", "AGB"]) {
    await page.goto(base, { referer: base });
    await page.waitForTimeout(600);
    await page.click(`.hero-footer >> text=${name}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${viewportName(name)}` });
  }
  function viewportName(section) {
    return `${name}-${section.toLowerCase()}.png`;
  }

  // a deep link to the privacy policy opens on it, without the intro
  await page.goto(`${base}#datenschutz`);
  await page.waitForTimeout(400);
  const deep = await page.evaluate(() => [document.documentElement.dataset.intro, Math.round(window.scrollY)]);
  if (deep[0] !== "done" || deep[1] < 200) failures.push(`${name} deep link opened as ${deep}`);


  // the intro in real time, skipped by a key press halfway
  await page.goto(base);
  await page.waitForTimeout(900);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const skipped = await page.evaluate(() => document.documentElement.dataset.intro);
  if (skipped !== "finished") failures.push(`${name} skip left the intro at ${skipped}`);
  await page.screenshot({ path: `${out}/${name}-skipped.png` });
  await context.close();

  // reduced motion opens on the finished logo
  const calm = await browser.newContext({ viewport: { width, height }, ...rest, reducedMotion: "reduce" });
  const calmPage = await calm.newPage();
  calmPage.on("pageerror", (error) => failures.push(`${name} calm ${error.message}`));
  await calmPage.goto(base);
  await calmPage.waitForTimeout(1200);
  const calmMode = await calmPage.evaluate(() => document.documentElement.dataset.intro);
  if (calmMode !== "calm") failures.push(`${name} reduced motion ran the intro as ${calmMode}`);
  await calmPage.screenshot({ path: `${out}/${name}-reduced.png` });
  await calm.close();

}

await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`ok, screenshots in ${out}/`);
