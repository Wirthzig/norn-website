// a walkthrough video of the site, desktop and phone: the intro, a slow scroll down,
// one legal page. webm from playwright, converted to mp4 with ffmpeg if it is there.
//   npm run build && npx vite preview --port 5611 &
//   node scripts/record.mjs http://localhost:5611/norn-website/
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5611/norn-website/";
const out = "shots/video";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

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

// the real gpu, the software renderer is too slow for the lens and the video stutters
const browser = await chromium.launch({ executablePath: browserPath(), args: ["--use-angle=metal", "--enable-gpu"] });
const runs = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

for (const [name, options] of Object.entries(runs)) {
  const dir = join(out, name);
  const context = await browser.newContext({ ...options, recordVideo: { dir, size: options.viewport } });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForTimeout(5200);
  // a slow scroll, as a person reads
  const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  for (let y = 0; y <= total; y += 12) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(1500);
  await page.goto(`${base}impressum/`);
  await page.waitForTimeout(2000);
  await page.goto(base, { referer: base });
  await page.waitForTimeout(2500);
  await context.close();
  const webm = readdirSync(dir).find((file) => file.endsWith(".webm"));
  renameSync(join(dir, webm), join(out, `${name}.webm`));
  rmSync(dir, { recursive: true });
  try {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", join(out, `${name}.webm`), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", join(out, `${name}.mp4`)]);
  } catch {
    console.log("no ffmpeg, webm only");
  }
}
await browser.close();
console.log(`videos in ${out}/`);
