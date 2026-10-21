// Run by `npm version` (the "version" script) after it has changed
// package.json: gives the Rust side the same version, so that Cargo.toml and
// Cargo.lock never disagree with the tag. The installers take their version
// from package.json, through tauri.conf.json.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

function replace(path, pattern, replacement) {
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) throw new Error(`No version found in ${path}`);
  writeFileSync(path, text.replace(pattern, replacement));
}

// The first `version = ` of Cargo.toml is the package's, under [package].
replace("src-tauri/Cargo.toml", /^version = ".*"$/m, `version = "${version}"`);
// In the lock file, the line after brock's name.
replace("src-tauri/Cargo.lock", /(name = "brock"\nversion = )".*"/, `$1"${version}"`);

execFileSync("git", ["add", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
console.log(`Cargo.toml and Cargo.lock are at ${version}`);
