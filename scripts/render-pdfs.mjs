import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pdfDir = path.join(root, "pdf");
const outDir = path.join(root, "assets", "floors");

const legacyDrawings = new Map([
  ["B1层布局图.pdf", { id: "b1", title: "B1层", image: "b1.png" }],
  ["1层布局图.pdf", { id: "f1", title: "1层", image: "f1.png" }],
  ["2层布局图.pdf", { id: "f2", title: "2层", image: "f2.png" }],
  ["3层布局图.pdf", { id: "f3", title: "3层", image: "f3.png" }],
  ["3层布局图（国际转国际开包间）.pdf", { id: "f3-transfer", title: "3层开包间", image: "f3-transfer.png" }],
  ["4层布局图.pdf", { id: "f4", title: "4层", image: "f4.png" }],
  ["2D总布局图.pdf", { id: "overview-2d", title: "2D总览", image: "overview-2d.png" }],
  ["3D总布局图.pdf", { id: "overview-3d", title: "3D总览", image: "overview-3d.png" }]
]);

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

function drawingId(fileName) {
  return `drawing-${createHash("sha1").update(fileName).digest("hex").slice(0, 10)}`;
}

function drawingTitle(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/布局图|总布局图/gu, "")
    .replace(/[()（）]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function readPreviousManifest() {
  try {
    const raw = await readFile(path.join(outDir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.drawings)) return new Map();
    return new Map(parsed.drawings.map((drawing) => [drawing.pdf, drawing]));
  } catch (error) {
    return new Map();
  }
}

async function renderPdf(fileName, previousDrawings) {
  const legacy = legacyDrawings.get(fileName);
  const id = legacy?.id || drawingId(fileName);
  const image = legacy?.image || `${id}.png`;
  const pdfPath = path.join(pdfDir, fileName);
  const outPath = path.join(outDir, image);
  const previous = previousDrawings.get(fileName);
  try {
    const [pdfInfo, imageInfo] = await Promise.all([stat(pdfPath), stat(outPath)]);
    if (previous && imageInfo.mtimeMs >= pdfInfo.mtimeMs) {
      return previous;
    }
  } catch (error) {
    // Missing output image or metadata means this PDF needs rendering.
  }

  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true
  }).promise;

  if (doc.numPages < 1) {
    throw new Error(`PDF has no pages: ${fileName}`);
  }

  const page = await doc.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetLongestSide = 3600;
  const scale = Math.min(5, targetLongestSide / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

  await page.render({
    canvasContext: canvasAndContext.context,
    viewport,
    canvasFactory
  }).promise;

  const png = await canvasAndContext.canvas.encode("png");
  await writeFile(outPath, png);
  canvasFactory.destroy(canvasAndContext);

  return {
    id,
    title: legacy?.title || drawingTitle(fileName) || path.basename(fileName, path.extname(fileName)),
    pdf: fileName,
    image,
    pages: doc.numPages,
    width: Math.ceil(viewport.width),
    height: Math.ceil(viewport.height)
  };
}

export async function renderPdfs() {
  await mkdir(outDir, { recursive: true });
  const previousDrawings = await readPreviousManifest();
  const pdfFiles = (await readdir(pdfDir))
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

  const manifest = [];
  for (const fileName of pdfFiles) {
    const drawing = await renderPdf(fileName, previousDrawings);
    manifest.push(drawing);
    console.log(`${drawing.title}: ${drawing.pdf} -> ${drawing.image} (${drawing.width}x${drawing.height}, pages=${drawing.pages})`);
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), drawings: manifest }, null, 2),
    "utf8"
  );
  return manifest;
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  renderPdfs().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
