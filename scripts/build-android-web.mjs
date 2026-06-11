import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(root, "www");

const runtimeFiles = ["index.html", "app.js", "styles.css"];
const runtimeDirectories = ["assets"];
const runtimeDataFiles = [
  "device-info.json",
  "points-manifest.json",
  "reference-points.json",
  "responsibility-zones.json",
  "search-index.json",
  "sync-data.json"
];

function includeRuntimeAsset(source) {
  return !path.basename(source).startsWith("._") &&
    !source.includes(`${path.sep}png-backup${path.sep}`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "data"), { recursive: true });

for (const file of runtimeFiles) {
  await cp(path.join(root, file), path.join(outputDir, file));
}

for (const directory of runtimeDirectories) {
  await cp(path.join(root, directory), path.join(outputDir, directory), {
    recursive: true,
    filter: includeRuntimeAsset
  });
}

for (const file of runtimeDataFiles) {
  await cp(path.join(root, "data", file), path.join(outputDir, "data", file));
}

await cp(path.join(root, "data", "drawings"), path.join(outputDir, "data", "drawings"), {
  recursive: true,
  filter: includeRuntimeAsset
});

const indexPath = path.join(outputDir, "index.html");
const indexHtml = await readFile(indexPath, "utf8");
await writeFile(
  indexPath,
  indexHtml.replace(
    "</head>",
    '    <meta name="theme-color" content="#0f766e">\n</head>'
  ),
  "utf8"
);

async function directorySize(directory) {
  let total = 0;
  const entries = await import("node:fs/promises").then((fs) =>
    fs.readdir(directory, { withFileTypes: true })
  );
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(fullPath);
    else total += (await stat(fullPath)).size;
  }
  return total;
}

const size = await directorySize(outputDir);
console.log(`Android web assets: ${(size / 1024 / 1024).toFixed(1)} MB`);
