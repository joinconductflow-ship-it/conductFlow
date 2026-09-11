import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const meetingAssistantUrl = process.env.MEETING_ASSISTANT_URL
  ?? "https://conductflow-woad.vercel.app/api/meeting-assistant";
const meetingAssistantSecret = process.env.MEETING_ASSISTANT_SECRET ?? "";

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    popup: path.join(root, "src/popup.ts"),
    background: path.join(root, "src/background.ts"),
    offscreen: path.join(root, "src/offscreen.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
    MEETING_ASSISTANT_URL: JSON.stringify(meetingAssistantUrl),
    MEETING_ASSISTANT_SECRET: JSON.stringify(meetingAssistantSecret),
  },
});

await Promise.all([
  cp(path.join(root, "manifest.json"), path.join(dist, "manifest.json")),
  cp(path.join(root, "popup.html"), path.join(dist, "popup.html")),
  cp(path.join(root, "offscreen.html"), path.join(dist, "offscreen.html")),
  cp(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true }),
]);

const onnxDist = path.join(root, "node_modules", "onnxruntime-web", "dist");
const wasmOutput = path.join(dist, "wasm");
await mkdir(wasmOutput, { recursive: true });

const runtimeAssets = (await readdir(onnxDist)).filter((name) => /^ort-wasm-.*\.(wasm|mjs)$/.test(name));
if (runtimeAssets.length === 0) {
  throw new Error(`No ONNX Runtime Web assets were found in ${onnxDist}`);
}
await Promise.all(runtimeAssets.map((name) => cp(path.join(onnxDist, name), path.join(wasmOutput, name))));

console.log(`Built Chrome extension in ${dist}`);
console.log(`Copied ${runtimeAssets.length} local ONNX Runtime Web WASM/module assets.`);
