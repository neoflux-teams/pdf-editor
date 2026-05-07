import { PDFDocument, rgb, StandardFonts, degrees } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as pdfjsLib from "pdfjs-dist";
import { saveAs } from "file-saver";

const CJK_FONT_URL =
  "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Regular.otf";

let cachedFontBytes: Uint8Array | null = null;

async function loadCJKFont(): Promise<Uint8Array> {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(CJK_FONT_URL);
  if (!res.ok) throw new Error(`字体下载失败 (${res.status})`);
  const buffer = await res.arrayBuffer();
  cachedFontBytes = new Uint8Array(buffer);
  return cachedFontBytes;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function loadPdfBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const bytes = await loadPdfBytes(file);
    const pdf = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

export async function splitPDF(
  file: File,
  ranges: [number, number][],
): Promise<Uint8Array[]> {
  const bytes = await loadPdfBytes(file);
  const pdf = await PDFDocument.load(bytes);
  const results: Uint8Array[] = [];

  for (const [start, end] of ranges) {
    const newPdf = await PDFDocument.create();
    const indices: number[] = [];
    for (let i = start; i <= end && i < pdf.getPageCount(); i++) {
      indices.push(i);
    }
    const pages = await newPdf.copyPages(pdf, indices);
    pages.forEach((page) => newPdf.addPage(page));
    results.push(await newPdf.save());
  }

  return results;
}

export async function rotatePDFPages(
  file: File,
  pageRotations: Map<number, number>,
): Promise<Uint8Array> {
  const bytes = await loadPdfBytes(file);
  const pdf = await PDFDocument.load(bytes);

  pageRotations.forEach((rotation, pageIndex) => {
    const page = pdf.getPage(pageIndex);
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees(currentRotation + rotation));
  });

  return pdf.save();
}

export async function addWatermark(
  file: File,
  text: string,
  options: {
    fontSize?: number;
    opacity?: number;
    rotation?: number;
  } = {},
): Promise<Uint8Array> {
  const { fontSize = 50, opacity = 0.3, rotation = -45 } = options;
  const bytes = await loadPdfBytes(file);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pdf.getPageCount(); i++) {
    const page = pdf.getPage(i);
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      rotate: degrees(rotation),
    });
  }

  return pdf.save();
}

export async function pdfToImages(
  file: File,
  scale = 2,
): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/png"));
  }

  return images;
}

export async function imagesToPDF(files: File[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  for (const file of files) {
    const bytes = await loadPdfBytes(file);
    let image;

    if (file.type === "image/png") {
      image = await pdf.embedPng(bytes);
    } else {
      image = await pdf.embedJpg(bytes);
    }

    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  return pdf.save();
}

export async function getPDFPageCount(file: File): Promise<number> {
  const bytes = await loadPdfBytes(file);
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount();
}

export async function renderPDFPage(
  file: File,
  pageNumber: number,
  scale = 1,
): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}

export function downloadPDF(data: Uint8Array, filename: string) {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/pdf" });
  saveAs(blob, filename);
}

export function downloadImage(dataUrl: string, filename: string) {
  saveAs(dataUrl, filename);
}

// --- Overlay Types for Interactive Editor ---

export interface OverlayBase {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
}

export interface TextOverlay extends OverlayBase {
  type: "text";
  text: string;
  fontSize: number;
  width: number;
  height: number;
}

export interface WhiteoutOverlay extends OverlayBase {
  type: "whiteout";
  width: number;
  height: number;
}

export interface ImageOverlay extends OverlayBase {
  type: "image";
  width: number;
  height: number;
  dataUrl: string;
}

export interface SignatureOverlay extends OverlayBase {
  type: "signature";
  width: number;
  height: number;
  dataUrl: string;
}

export type Overlay =
  | TextOverlay
  | WhiteoutOverlay
  | ImageOverlay
  | SignatureOverlay;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function applyOverlays(
  file: File,
  overlays: Overlay[],
): Promise<Uint8Array> {
  const bytes = await loadPdfBytes(file);
  const pdf = await PDFDocument.load(bytes);

  // Use CJK font for Chinese character support
  const cjkFontBytes = await loadCJKFont();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(cjkFontBytes);

  for (const overlay of overlays) {
    const page = pdf.getPage(overlay.pageIndex);

    switch (overlay.type) {
      case "whiteout": {
        page.drawRectangle({
          x: overlay.x,
          y: overlay.y,
          width: overlay.width,
          height: overlay.height,
          color: rgb(1, 1, 1),
        });
        break;
      }
      case "text": {
        page.drawText(overlay.text, {
          x: overlay.x,
          y: overlay.y,
          size: overlay.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        break;
      }
      case "image":
      case "signature": {
        const imgBytes = dataUrlToBytes(overlay.dataUrl);
        let image;
        if (overlay.dataUrl.includes("image/png")) {
          image = await pdf.embedPng(imgBytes);
        } else {
          image = await pdf.embedJpg(imgBytes);
        }
        page.drawImage(image, {
          x: overlay.x,
          y: overlay.y,
          width: overlay.width,
          height: overlay.height,
        });
        break;
      }
    }
  }

  return pdf.save();
}
