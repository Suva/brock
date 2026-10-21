// Builds the website into _site/: the page in site/, with this version's
// download links filled in, and the demo, which is the app's window built
// for a browser (`--mode demo`, opening on the tour in src/demo/tour.ts).
//
//   node scripts/build-site.mjs           build
//   node scripts/build-site.mjs --serve   build, then serve it at http://127.0.0.1:4321
//   node scripts/build-site.mjs --pictures  build, then take site/demo.png and
//                                           demo-dark.png, shown on phones in
//                                           place of the demo, with Chrome

import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const OUT = "_site";
const PORT = 4321;
const REPOSITORY = "https://github.com/Suva/brock";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The demo: relative addresses, so that it works wherever the site is put.
execFileSync("npx", ["vite", "build", "--mode", "demo", "--outDir", join(OUT, "demo"), "--base", "./", "--emptyOutDir"], {
  stdio: "inherit",
});

// The page, with the links to this version's installers on its release.
const page = readFileSync("site/index.html", "utf8")
  .replaceAll("{{VERSION}}", version)
  .replaceAll("{{RELEASE}}", `${REPOSITORY}/releases/download/v${version}`);
if (page.includes("{{")) throw new Error("site/index.html has a {{…}} the build does not know");
writeFileSync(join(OUT, "index.html"), page);

const files = {
  "site/style.css": "style.css",
  "site/demo.png": "demo.png",
  "site/demo-dark.png": "demo-dark.png",
  "brand/brock-icon.svg": "logo.svg",
  "src-tauri/icons/128x128@2x.png": "icon.png",
  "static/favicon.png": "favicon.png",
};
for (const [from, to] of Object.entries(files)) {
  if (existsSync(from)) copyFileSync(from, join(OUT, to));
  else console.warn(`Missing ${from}; the page will go without ${to}`);
}
console.log(`\nThe site is in ${OUT}/, for version ${version}.`);

if (process.argv.includes("--serve")) serve();
if (process.argv.includes("--pictures")) pictures();

/** Pictures of the demo as it opens, light and dark, taken by Chrome without a window. */
async function pictures() {
  const chrome = {
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    win32: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  }[process.platform] ?? "google-chrome";
  const server = serve();
  const take = (file, scheme) =>
    new Promise((resolve, reject) => {
      const profile = join(OUT, `.chrome-${scheme}`);
      execFile(chrome, [
        "--headless=new",
        `--user-data-dir=${profile}`,
        "--hide-scrollbars",
        "--window-size=1200,720",
        "--force-device-scale-factor=2",
        // 0 is dark and 1 light, whatever this computer is set to.
        `--blink-settings=preferredColorScheme=${scheme === "dark" ? 0 : 1}`,
        // Time for the map to be measured and fitted into view.
        "--virtual-time-budget=5000",
        `--screenshot=${join(process.cwd(), file)}`,
        `http://127.0.0.1:${PORT}/demo/`,
      ], (error) => {
        rmSync(profile, { recursive: true, force: true });
        error ? reject(error) : resolve();
      });
    });
  await take("site/demo.png", "light");
  await take("site/demo-dark.png", "dark");
  server.close();
  console.log("Took site/demo.png and site/demo-dark.png; look at them before committing.");
}

/** A small server for trying the site, as GitHub Pages would serve it. */
function serve() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
  };
  return createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(OUT, path));
    if (!file.startsWith(OUT) || !existsSync(file)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  }).listen(PORT, "127.0.0.1", () => {
    if (process.argv.includes("--serve")) console.log(`Serving it at http://127.0.0.1:${PORT}/ (Ctrl+C stops)`);
  });
}
