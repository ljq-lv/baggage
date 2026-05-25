import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pdfDir = path.join(root, "pdf");
const outDir = path.join(root, "assets", "floors");

const drawings = [
  { id: "b1", title: "B1层", pdf: "B1层布局图.pdf", image: "b1.png" },
  { id: "f1", title: "1层", pdf: "1层布局图.pdf", image: "f1.png" },
  { id: "f2", title: "2层", pdf: "2层布局图.pdf", image: "f2.png" },
  { id: "f3", title: "3层", pdf: "3层布局图.pdf", image: "f3.png" },
  {
    id: "f3-transfer",
    title: "3层开包间",
    pdf: "3层布局图（国际转国际开包间）.pdf",
    image: "f3-transfer.png"
  },
  { id: "f4", title: "4层", pdf: "4层布局图.pdf", image: "f4.png" },
  { id: "overview-2d", title: "2D总览", pdf: "2D总布局图.pdf", image: "overview-2d.png" },
  { id: "overview-3d", title: "3D总览", pdf: "3D总布局图.pdf", image: "overview-3d.png" }
];

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

async function main() {
  await mkdir(outDir, { recursive: true });
  const existing = new Set(await readdir(pdfDir));
  const manifest = [];

  for (const drawing of drawings) {
    if (!existing.has(drawing.pdf)) {
      throw new Error(`PDF not found: ${drawing.pdf}`);
    }

    const pdfPath = path.join(pdfDir, drawing.pdf);
    const data = new Uint8Array(await import("node:fs/promises").then((fs) => fs.readFile(pdfPath)));
    const doc = await pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: true
    }).promise;

    if (doc.numPages < 1) {
      throw new Error(`PDF has no pages: ${drawing.pdf}`);
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
    const outPath = path.join(outDir, drawing.image);
    await writeFile(outPath, png);
    canvasFactory.destroy(canvasAndContext);

    manifest.push({
      ...drawing,
      pages: doc.numPages,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height)
    });
    console.log(`${drawing.title}: ${drawing.pdf} -> ${drawing.image} (${Math.ceil(viewport.width)}x${Math.ceil(viewport.height)}, pages=${doc.numPages})`);
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), drawings: manifest }, null, 2),
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
