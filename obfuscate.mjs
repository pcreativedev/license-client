/**
 * Post-build obfuscation step for @pcreative/license-client.
 *
 * tsc emits readable ES modules to dist/. This script runs the result
 * through javascript-obfuscator with aggressive settings tuned for an
 * anti-tamper bundle (string array rotation, dead code injection,
 * self-defending wrapper). Source maps are deleted because shipping
 * them would defeat the whole point.
 *
 * The .d.ts types are left untouched — buyers still get full IntelliSense.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import obfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "dist");

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["rc4"],
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  // Templates run on Node, not the browser — disable global self/window checks
  target: "node",
};

const jsFiles = (await fs.readdir(distDir)).filter((f) => f.endsWith(".js"));

for (const file of jsFiles) {
  const full = path.join(distDir, file);
  const src = await fs.readFile(full, "utf-8");
  const result = obfuscator.obfuscate(src, options);
  await fs.writeFile(full, result.getObfuscatedCode());
  console.log(`obfuscated: ${file} (${(src.length / 1024).toFixed(1)}KB → ${(result.getObfuscatedCode().length / 1024).toFixed(1)}KB)`);
}

// Source maps would re-expose the original source — drop them.
const mapFiles = (await fs.readdir(distDir)).filter((f) => f.endsWith(".js.map"));
for (const f of mapFiles) {
  await fs.unlink(path.join(distDir, f));
  console.log(`removed: ${f}`);
}

console.log("done.");
