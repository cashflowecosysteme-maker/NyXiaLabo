#!/usr/bin/env node
/**
 * NyXiaLabo — Azgaar auto-hébergé dans le même Worker Cloudflare.
 * Révision verrouillée pour reproductibilité.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SOURCE = join(ROOT, ".azgaar-src");
const OUT = join(ROOT, "cartographie", "azgaar");
const REPO = "https://github.com/Azgaar/Fantasy-Map-Generator.git";
const COMMIT = "a7289d3e21bcd0ab3dc73d87b29c9ad8c32a2f94";
const EXPECTED_VERSION = "1.152.2";
const BASE_PATH = "/cartographie/azgaar/";

function run(cmd, args, cwd = ROOT) {
  console.log(`[NyXia/Azgaar] ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
}

console.log("[NyXia/Azgaar] Préparation de l'éditeur complet auto-hébergé…");
rmSync(SOURCE, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(SOURCE, { recursive: true });
mkdirSync(OUT, { recursive: true });

run("git", ["init"], SOURCE);
run("git", ["remote", "add", "origin", REPO], SOURCE);
run("git", ["fetch", "--depth", "1", "origin", COMMIT], SOURCE);
run("git", ["checkout", "--detach", "FETCH_HEAD"], SOURCE);

const pkg = JSON.parse(readFileSync(join(SOURCE, "package.json"), "utf8"));
if (pkg.version !== EXPECTED_VERSION) {
  throw new Error(`Version Azgaar inattendue: ${pkg.version}; attendue: ${EXPECTED_VERSION}`);
}

const vitePath = join(SOURCE, "vite.config.ts");
let vite = readFileSync(vitePath, "utf8");
const before = 'base: mode === "electron" ? "./" : process.env.NETLIFY ? "/" : "/Fantasy-Map-Generator/",';
const after = `base: mode === "electron" ? "./" : "${BASE_PATH}",`;
if (!vite.includes(before)) {
  throw new Error("Le vite.config.ts d'Azgaar a changé; arrêt volontaire pour ne pas produire un build incorrect.");
}
vite = vite.replace(before, after);
writeFileSync(vitePath, vite, "utf8");

run("npm", ["ci", "--no-audit", "--no-fund"], SOURCE);
run("npm", ["run", "build"], SOURCE);

const dist = join(SOURCE, "dist");
if (!existsSync(join(dist, "index.html"))) {
  throw new Error("Build Azgaar incomplet: dist/index.html introuvable");
}
cpSync(dist, OUT, { recursive: true });
cpSync(join(SOURCE, "LICENSE"), join(OUT, "LICENSE-AZGAAR.txt"));
writeFileSync(
  join(OUT, "nyxia-build.json"),
  JSON.stringify({ engine: "Azgaar Fantasy Map Generator", version: EXPECTED_VERSION, commit: COMMIT, basePath: BASE_PATH, builtAt: new Date().toISOString() }, null, 2),
  "utf8"
);

// Le source temporaire et ses node_modules ne font jamais partie des assets publiés.
rmSync(SOURCE, { recursive: true, force: true });
console.log(`[NyXia/Azgaar] OK — éditeur ${EXPECTED_VERSION} prêt dans ${BASE_PATH}`);
