import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push(".");

const files = [];

function add(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules") continue;
      add(join(path, name));
    }
    return;
  }
  if (path.endsWith(".js") || path.endsWith(".mjs")) files.push(path);
}

for (const root of roots) add(root);

let status = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) status = result.status || 1;
}

process.exit(status);
