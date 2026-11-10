// Records tour.html to video/tour.mp4, frame by frame.
//
//   node tour-source/record.js            the whole 40 seconds -> video/tour.mp4 and img/tour-poster.jpg
//   node tour-source/record.js still 12.5 [out.png]   one PNG of second 12.5 (to check a frame)
//
// Needs Google Chrome, ffmpeg on the PATH, and puppeteer-core (it lives in ../../platform/node_modules).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PLATFORM = path.resolve(ROOT, "..", "..", "platform");
const puppeteer = require(require.resolve("puppeteer-core", { paths: [PLATFORM] }));
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FPS = 24, TOTAL = 40;
const url = "file:///" + path.join(__dirname, "tour.html").replace(/\\/g, "/") + "#record";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const stage = await page.$("#stage");

  if (process.argv[2] === "still") {
    const t = Number(process.argv[3] || 0);
    await page.evaluate((t) => window.__seek(t), t);
    await new Promise((r) => setTimeout(r, 120));
    const out = process.argv[4] || path.join(__dirname, "_still.png");
    await stage.screenshot({ path: out });
    console.log("wrote", out);
    await browser.close();
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tour-frames-"));
  const frames = FPS * TOTAL;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.__seek(t), i / FPS);
    await stage.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
    if (i % 120 === 0) console.log(`frame ${i}/${frames}`);
  }
  await browser.close();

  fs.mkdirSync(path.join(ROOT, "video"), { recursive: true });
  const mp4 = path.join(ROOT, "video", "tour.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "inherit" });
  // the poster is the report scene in the macaws.ai brand (second 26.4): the player's
  // controls cover the bottom of a poster, so it needs nothing important down there
  const posterFrame = String(Math.round(26.4 * FPS)).padStart(4, "0");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, `f${posterFrame}.png`), "-q:v", "3",
    path.join(ROOT, "img", "tour-poster.jpg")], { stdio: "inherit" });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("wrote", mp4, (fs.statSync(mp4).size / 1048576).toFixed(2) + " MB");
})();
