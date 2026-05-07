import { useState, useEffect, useRef, useCallback } from "react";
import {
  Save,
  ArrowLeft,
  FileText,
  MousePointerSquareDashed,
  Eraser,
  Image as ImageIcon,
  Pen,
  Droplets,
  X,
  Check,
  Trash2,
  Copy,
  Plus,
  GripVertical,
} from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, rgb, degrees } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { saveAs } from "file-saver";

// Inline worker code to avoid external loading issues
import workerCode from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
const workerBlob = new Blob([workerCode], { type: "application/javascript" });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

const RENDER_SCALE = 2;

// Load Noto Sans SC (same family as Source Han Sans CN used in saved PDF)
const NOTO_SANS_SC_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap";
let fontLinkLoaded = false;
function ensureDisplayFont() {
  if (fontLinkLoaded) return;
  fontLinkLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = NOTO_SANS_SC_CSS;
  document.head.appendChild(link);
}

const DISPLAY_FONT = '"Noto Sans SC", "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", sans-serif';

// CJK font: Adobe Source Han Sans CN (open-source, ~5MB, cached after first load)
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

// --- Types ---

interface LineInfo {
  text: string;
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfFontSize: number;
  viewportX: number;
  viewportY: number;
  viewportWidth: number;
  lineHeight: number;
}

interface TextBlock {
  id: string;
  text: string;
  originalText: string;
  lines: LineInfo[];
  pdfFontSize: number;
  viewportX: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  pageIndex: number;
}

interface PageData {
  pageNum: number;
  sourcePageNum: number; // original page number in the loaded PDF (0 = blank page)
  viewport: { width: number; height: number };
  rawTextContent: any;
  canvasUrl: string;
  editableBlocks: TextBlock[];
}

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ToolMode = "select" | "whiteout" | "image" | "signature" | "watermark";

interface OverlayItem {
  id: string;
  type: "whiteout" | "image" | "signature";
  pageIndex: number;
  // PDF coordinates (origin bottom-left)
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  // Viewport coordinates for display
  viewportX: number;
  viewportY: number; // top edge in viewport
  viewportW: number;
  viewportH: number;
  rotation: number; // degrees
  dataUrl?: string; // for image/signature
}

type DragAction =
  | { type: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { type: "resize"; id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number }
  | { type: "rotate"; id: string; centerX: number; centerY: number; startAngle: number; origRotation: number };

// --- Helpers ---

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function extractBlocksInRect(
  textContent: any,
  viewport: any,
  scale: number,
  pageIndex: number,
  rect: SelectionRect,
  existingIds: Set<string>,
): TextBlock[] {
  const items = textContent.items as any[];
  const matched: any[] = [];

  for (const item of items) {
    if (!item.str) continue;
    const tx = item.transform[4];
    const ty = item.transform[5];
    const fontSize = Math.sqrt(
      item.transform[0] * item.transform[0] +
        item.transform[1] * item.transform[1],
    );
    const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
    const vw = (item.width || 0) * scale;
    const vh = fontSize * scale;
    const itemTop = vy - vh;

    if (!rectsOverlap(vx, itemTop, Math.max(vw, 4), vh, rect.x, rect.y, rect.w, rect.h)) {
      continue;
    }
    matched.push({ ...item, vx, vy, vw, vh, fontSize });
  }

  if (matched.length === 0) return [];

  // Sort by Y, then X
  matched.sort((a, b) => a.vy - b.vy || a.vx - b.vx);

  // Group into lines using adaptive threshold (half font height)
  const rawLines: any[][] = [];
  let curLine: any[] = [matched[0]];
  for (let i = 1; i < matched.length; i++) {
    const item = matched[i];
    const prev = curLine[curLine.length - 1];
    const threshold = Math.max(prev.vh, item.vh) * 0.5;
    if (Math.abs(item.vy - prev.vy) <= threshold) {
      curLine.push(item);
    } else {
      rawLines.push(curLine);
      curLine = [item];
    }
  }
  rawLines.push(curLine);

  // Build per-line info
  const lineInfos: LineInfo[] = [];
  let globalLeft = Infinity;
  let globalRight = -Infinity;
  let globalTop = Infinity;
  let globalBottom = -Infinity;
  let mainFontSize = 0;

  for (const lineItems of rawLines) {
    lineItems.sort((a: any, b: any) => a.vx - b.vx);
    const text = lineItems.map((i: any) => i.str).join("");
    if (!text.trim()) continue;

    const first = lineItems[0];
    const last = lineItems[lineItems.length - 1];
    const pdfFontSize = first.fontSize;
    const pdfWidth = lineItems.reduce((sum: number, it: any) => sum + (it.width || 0), 0);

    const vLeft = first.vx;
    const vRight = last.vx + last.vw;
    const vWidth = Math.max(vRight - vLeft, 20);
    const avgVy = lineItems.reduce((s: number, it: any) => s + it.vy, 0) / lineItems.length;
    const lh = pdfFontSize * scale * 1.1;

    lineInfos.push({
      text,
      pdfX: first.transform[4],
      pdfY: first.transform[5],
      pdfWidth,
      pdfFontSize,
      viewportX: vLeft,
      viewportY: avgVy,
      viewportWidth: vWidth,
      lineHeight: lh,
    });

    if (vLeft < globalLeft) globalLeft = vLeft;
    if (vRight > globalRight) globalRight = vRight;
    const lineTop = avgVy - lh;
    if (lineTop < globalTop) globalTop = lineTop;
    if (avgVy > globalBottom) globalBottom = avgVy;
    if (pdfFontSize > mainFontSize) mainFontSize = pdfFontSize;
  }

  if (lineInfos.length === 0) return [];

  const posKey = `${Math.round(globalLeft)}_${Math.round(globalTop)}`;
  if (existingIds.has(posKey)) return [];

  const fullText = lineInfos.map((l) => l.text).join("\n");
  const blockWidth = Math.max(globalRight - globalLeft, 20);
  const blockHeight = globalBottom - globalTop + 2;

  return [
    {
      id: generateId(),
      text: fullText,
      originalText: fullText,
      lines: lineInfos,
      pdfFontSize: mainFontSize,
      viewportX: globalLeft,
      viewportTop: globalTop,
      viewportWidth: blockWidth,
      viewportHeight: blockHeight,
      pageIndex,
    },
  ];
}

// Render PDF page, erase text blocks (per-line), return data URL
async function renderPageWithErasures(
  pdfDoc: any,
  pageNum: number,
  blocks: TextBlock[],
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  ctx.fillStyle = "#ffffff";
  for (const block of blocks) {
    for (const line of block.lines) {
      const x = line.viewportX - 1;
      const y = line.viewportY - line.lineHeight;
      ctx.fillRect(x, y, line.viewportWidth + 2, line.lineHeight + 2);
    }
  }

  return canvas.toDataURL("image/png");
}

// --- EditableBlock component ---

function EditableBlock({
  block,
  scale,
  onTextChange,
  onRemove,
}: {
  block: TextBlock;
  scale: number;
  onTextChange: (text: string) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState(block.text);
  const modified = value !== block.originalText;
  const singleLineH = block.lines[0]?.lineHeight || block.pdfFontSize * scale * 1.1;
  const rows = block.lines.length;

  useEffect(() => {
    setValue(block.text);
  }, [block.text]);

  return (
    <div
      className="absolute group"
      style={{
        left: block.viewportX - 1,
        top: block.viewportTop - 1,
        zIndex: focused ? 20 : 10,
        padding: 1,
        border: focused
          ? "0.5px dashed rgba(59,130,246,0.7)"
          : modified
            ? "0.5px dashed rgba(234,179,8,0.6)"
            : "0.5px dashed rgba(156,163,175,0.4)",
        borderRadius: "1px",
        transition: "border-color 0.15s",
      }}
    >
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        onChange={(e) => setValue(e.target.value)}
        className="block resize-none outline-none cursor-text select-text"
        style={{
          width: block.viewportWidth + 4,
          height: singleLineH * rows + 2,
          fontSize: block.pdfFontSize * scale,
          lineHeight: `${singleLineH}px`,
          color: "#111827",
          fontFamily: DISPLAY_FONT,
          padding: 0,
          margin: 0,
          border: "none",
          borderRadius: 0,
          letterSpacing: "0px",
          boxSizing: "border-box",
          overflow: "hidden",
          background: "transparent",
          WebkitAppearance: "none",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onTextChange(value);
        }}
      />
      {/* Remove button */}
      <button
        className="absolute -top-3 -right-3 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="移除此文本框"
      >
        ×
      </button>
    </div>
  );
}

// --- Main component ---

export default function SmartEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pdfRef = useRef<any>(null);

  // Tool mode
  const [tool, setTool] = useState<ToolMode>("select");

  // Selection state (for text extraction)
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<SelectionRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Overlay state (whiteout, image, signature)
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  // Whiteout drawing
  const [whiteoutDrawing, setWhiteoutDrawing] = useState(false);
  const [whiteoutStart, setWhiteoutStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [whiteoutRect, setWhiteoutRect] = useState<SelectionRect | null>(null);

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImgPos, setPendingImgPos] = useState<{ x: number; y: number } | null>(null);

  // Signature modal
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [sigPos, setSigPos] = useState<{ x: number; y: number } | null>(null);
  const [sigDrawing, setSigDrawing] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);

  // Watermark modal
  const [watermarkModalOpen, setWatermarkModalOpen] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkFontSize, setWatermarkFontSize] = useState(50);
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.3);
  const [watermarkRotation, setWatermarkRotation] = useState(-45);
  const [watermarkImageDataUrl, setWatermarkImageDataUrl] = useState<string | null>(null);
  const watermarkFileRef = useRef<HTMLInputElement>(null);

  // Overlay drag/resize/rotate
  const [dragAction, setDragAction] = useState<DragAction | null>(null);

  // Page sidebar drag reorder
  const [dragPageIdx, setDragPageIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  // --- Page management ---

  const createBlankPageData = useCallback((insertIdx: number, refPage?: PageData): PageData => {
    const vp = refPage?.viewport ?? { width: 595 * RENDER_SCALE, height: 842 * RENDER_SCALE };
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, vp.width, vp.height);
    return {
      pageNum: insertIdx + 1,
      sourcePageNum: 0,
      viewport: { ...vp },
      rawTextContent: { items: [] },
      canvasUrl: canvas.toDataURL("image/png"),
      editableBlocks: [],
    };
  }, []);

  const addBlankPage = useCallback(() => {
    const refPage = pages[currentPage] || pages[0];
    const insertIdx = currentPage + 1;
    const blank = createBlankPageData(insertIdx, refPage);
    const newPages = [...pages];
    newPages.splice(insertIdx, 0, blank);
    // Re-number
    newPages.forEach((p, i) => (p.pageNum = i + 1));
    setPages(newPages);
    setCurrentPage(insertIdx);
  }, [pages, currentPage, createBlankPageData]);

  const duplicatePage = useCallback((idx: number) => {
    const source = pages[idx];
    if (!source) return;
    const dup: PageData = {
      ...source,
      pageNum: idx + 2,
      editableBlocks: source.editableBlocks.map((b) => ({ ...b, id: generateId() })),
    };
    const newPages = [...pages];
    newPages.splice(idx + 1, 0, dup);
    // Also duplicate overlays for this page
    const dupeOverlays = overlays
      .filter((o) => o.pageIndex === idx)
      .map((o) => ({ ...o, id: generateId(), pageIndex: idx + 1 }));
    // Shift overlays after insert point
    const shiftedOverlays = overlays.map((o) =>
      o.pageIndex > idx ? { ...o, pageIndex: o.pageIndex + 1 } : o,
    );
    setOverlays([...shiftedOverlays, ...dupeOverlays]);
    newPages.forEach((p, i) => (p.pageNum = i + 1));
    setPages(newPages);
    setCurrentPage(idx + 1);
  }, [pages, overlays]);

  const deletePage = useCallback((idx: number) => {
    if (pages.length <= 1) return;
    const newPages = pages.filter((_, i) => i !== idx);
    newPages.forEach((p, i) => (p.pageNum = i + 1));
    // Remove overlays for this page and shift indices
    const newOverlays = overlays
      .filter((o) => o.pageIndex !== idx)
      .map((o) => (o.pageIndex > idx ? { ...o, pageIndex: o.pageIndex - 1 } : o));
    setOverlays(newOverlays);
    setPages(newPages);
    if (currentPage >= newPages.length) {
      setCurrentPage(newPages.length - 1);
    } else if (currentPage > idx) {
      setCurrentPage((p) => p - 1);
    }
  }, [pages, overlays, currentPage]);

  const reorderPages = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const newPages = [...pages];
    const [moved] = newPages.splice(fromIdx, 1);
    newPages.splice(toIdx, 0, moved);
    newPages.forEach((p, i) => (p.pageNum = i + 1));
    // Remap overlay page indices
    const newOverlays = overlays.map((o) => {
      let newIdx = o.pageIndex;
      if (o.pageIndex === fromIdx) {
        newIdx = toIdx;
      } else if (fromIdx < toIdx) {
        if (o.pageIndex > fromIdx && o.pageIndex <= toIdx) newIdx = o.pageIndex - 1;
      } else {
        if (o.pageIndex >= toIdx && o.pageIndex < fromIdx) newIdx = o.pageIndex + 1;
      }
      return { ...o, pageIndex: newIdx };
    });
    setOverlays(newOverlays);
    setPages(newPages);
    // Follow the moved page
    setCurrentPage(toIdx);
  }, [pages, overlays]);

  // --- File loading ---

  const handleFile = useCallback(async (files: File[]) => {
    if (!files[0]) return;
    ensureDisplayFont();
    const f = files[0];
    setFile(f);
    setLoading(true);
    setCurrentPage(0);

    try {
      const buffer = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      pdfRef.current = pdf;

      const pageDataList: PageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const textContent = await page.getTextContent();

        // Render clean canvas (no erasures yet)
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL("image/png");

        pageDataList.push({
          pageNum: i,
          sourcePageNum: i,
          viewport: { width: viewport.width, height: viewport.height },
          rawTextContent: textContent,
          canvasUrl: url,
          editableBlocks: [],
        });
      }

      setPages(pageDataList);
    } catch (err) {
      alert("加载失败: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Helper: viewport pos to PDF pos ---

  const viewportToPdf = useCallback(
    (vx: number, vy: number) => {
      const pageData = pages[currentPage];
      if (!pageData) return { pdfX: 0, pdfY: 0 };
      const pdfX = vx / RENDER_SCALE;
      const pdfY = (pageData.viewport.height - vy) / RENDER_SCALE;
      return { pdfX, pdfY };
    },
    [pages, currentPage],
  );

  // --- Mouse handlers ---

  const getRelativePos = useCallback(
    (e: React.MouseEvent) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  // Helper to sync viewport -> PDF coords on an overlay
  const syncOverlayPdf = useCallback(
    (o: OverlayItem): OverlayItem => {
      const pageData = pages[currentPage];
      if (!pageData) return o;
      const pdfX = o.viewportX / RENDER_SCALE;
      const pdfY = (pageData.viewport.height - o.viewportY - o.viewportH) / RENDER_SCALE;
      return { ...o, pdfX, pdfY, pdfWidth: o.viewportW / RENDER_SCALE, pdfHeight: o.viewportH / RENDER_SCALE };
    },
    [pages, currentPage],
  );

  // Start overlay interaction from child component
  const startOverlayAction = useCallback(
    (action: DragAction, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDragAction(action);
      setSelectedOverlayId(action.id);
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "INPUT") return;

      const pos = getRelativePos(e);

      if (tool === "select") {
        setSelectedOverlayId(null);
        // Start text selection
        setSelecting(true);
        setSelStart(pos);
        setSelRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
        return;
      }

      if (tool === "whiteout") {
        setWhiteoutDrawing(true);
        setWhiteoutStart(pos);
        setWhiteoutRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
        return;
      }

      if (tool === "image") {
        setPendingImgPos(pos);
        fileInputRef.current?.click();
        setTool("select");
        return;
      }

      if (tool === "signature") {
        setSigPos(pos);
        setSigModalOpen(true);
        setTool("select");
        return;
      }
    },
    [getRelativePos, tool],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePos(e);

      // Overlay drag/resize/rotate
      if (dragAction) {
        e.preventDefault();
        if (dragAction.type === "move") {
          const dx = pos.x - dragAction.startX;
          const dy = pos.y - dragAction.startY;
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === dragAction.id
                ? { ...o, viewportX: dragAction.origX + dx, viewportY: dragAction.origY + dy }
                : o,
            ),
          );
        } else if (dragAction.type === "resize") {
          const dx = pos.x - dragAction.startX;
          const dy = pos.y - dragAction.startY;
          const h = dragAction.handle;
          setOverlays((prev) =>
            prev.map((o) => {
              if (o.id !== dragAction.id) return o;
              let { origX: nx, origY: ny, origW: nw, origH: nh } = dragAction;
              if (h.includes("e")) nw = Math.max(20, dragAction.origW + dx);
              if (h.includes("w")) { nw = Math.max(20, dragAction.origW - dx); nx = dragAction.origX + dx; }
              if (h.includes("s")) nh = Math.max(20, dragAction.origH + dy);
              if (h.includes("n")) { nh = Math.max(20, dragAction.origH - dy); ny = dragAction.origY + dy; }
              if (h === "se" || h === "sw" || h === "ne" || h === "nw") {
                // uniform scale from corner
                const scaleX = nw / dragAction.origW;
                const scaleY = nh / dragAction.origH;
                const scale = (scaleX + scaleY) / 2;
                nw = Math.max(20, dragAction.origW * scale);
                nh = Math.max(20, dragAction.origH * scale);
                if (h.includes("w")) nx = dragAction.origX + dragAction.origW - nw;
                if (h.includes("n")) ny = dragAction.origY + dragAction.origH - nh;
              }
              return { ...o, viewportX: nx, viewportY: ny, viewportW: nw, viewportH: nh };
            }),
          );
        } else if (dragAction.type === "rotate") {
          const angle = Math.atan2(pos.y - dragAction.centerY, pos.x - dragAction.centerX) * 180 / Math.PI;
          const delta = angle - dragAction.startAngle;
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === dragAction.id
                ? { ...o, rotation: dragAction.origRotation + delta }
                : o,
            ),
          );
        }
        return;
      }

      if (selecting && selStart) {
        setSelRect({
          x: Math.min(selStart.x, pos.x),
          y: Math.min(selStart.y, pos.y),
          w: Math.abs(pos.x - selStart.x),
          h: Math.abs(pos.y - selStart.y),
        });
        return;
      }

      if (whiteoutDrawing) {
        setWhiteoutRect({
          x: Math.min(whiteoutStart.x, pos.x),
          y: Math.min(whiteoutStart.y, pos.y),
          w: Math.abs(pos.x - whiteoutStart.x),
          h: Math.abs(pos.y - whiteoutStart.y),
        });
        return;
      }
    },
    [selecting, selStart, whiteoutDrawing, whiteoutStart, getRelativePos, dragAction],
  );

  const handleMouseUp = useCallback(async () => {
    // --- Finish overlay drag/resize/rotate ---
    if (dragAction) {
      setOverlays((prev) => prev.map((o) => o.id === dragAction.id ? syncOverlayPdf(o) : o));
      setDragAction(null);
      return;
    }

    // --- Whiteout finish ---
    if (whiteoutDrawing && whiteoutRect && whiteoutRect.w > 5 && whiteoutRect.h > 5) {
      const { pdfX, pdfY } = viewportToPdf(whiteoutRect.x, whiteoutRect.y + whiteoutRect.h);
      setOverlays((prev) => [
        ...prev,
        {
          id: generateId(),
          type: "whiteout",
          pageIndex: currentPage,
          pdfX,
          pdfY,
          pdfWidth: whiteoutRect.w / RENDER_SCALE,
          pdfHeight: whiteoutRect.h / RENDER_SCALE,
          viewportX: whiteoutRect.x,
          viewportY: whiteoutRect.y,
          viewportW: whiteoutRect.w,
          viewportH: whiteoutRect.h,
          rotation: 0,
        },
      ]);
      setWhiteoutDrawing(false);
      setWhiteoutRect(null);
      return;
    }
    if (whiteoutDrawing) {
      setWhiteoutDrawing(false);
      setWhiteoutRect(null);
      return;
    }

    // --- Text selection finish ---
    if (!selecting || !selRect || !pdfRef.current) {
      setSelecting(false);
      setSelRect(null);
      setSelStart(null);
      return;
    }

    setSelecting(false);
    setSelStart(null);

    if (selRect.w < 10 || selRect.h < 10) {
      setSelRect(null);
      return;
    }

    const pageData = pages[currentPage];
    if (!pageData) {
      setSelRect(null);
      return;
    }

    const page = await pdfRef.current.getPage(pageData.pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const existingKeys = new Set(
      pageData.editableBlocks.map(
        (b) => `${Math.round(b.viewportX)}_${Math.round(b.viewportTop)}`,
      ),
    );

    const newBlocks = extractBlocksInRect(
      pageData.rawTextContent,
      viewport,
      RENDER_SCALE,
      currentPage,
      selRect,
      existingKeys,
    );

    if (newBlocks.length === 0) {
      setSelRect(null);
      return;
    }

    const allBlocks = [...pageData.editableBlocks, ...newBlocks];

    const newUrl = await renderPageWithErasures(
      pdfRef.current,
      pageData.pageNum,
      allBlocks,
    );

    setPages((prev) =>
      prev.map((p, i) =>
        i === currentPage
          ? { ...p, editableBlocks: allBlocks, canvasUrl: newUrl }
          : p,
      ),
    );
    setSelRect(null);
  }, [selecting, selRect, pages, currentPage, whiteoutDrawing, whiteoutRect, viewportToPdf, dragAction, syncOverlayPdf]);

  // --- Image upload handler ---

  const handleImageFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const imgFile = e.target.files?.[0];
      if (!imgFile || !pendingImgPos) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 300;
          const scale = Math.min(1, maxW / img.width);
          const w = img.width * scale;
          const h = img.height * scale;
          const { pdfX, pdfY } = viewportToPdf(pendingImgPos.x, pendingImgPos.y + h);
          setOverlays((prev) => [
            ...prev,
            {
              id: generateId(),
              type: "image",
              pageIndex: currentPage,
              pdfX,
              pdfY,
              pdfWidth: w / RENDER_SCALE,
              pdfHeight: h / RENDER_SCALE,
              viewportX: pendingImgPos.x,
              viewportY: pendingImgPos.y,
              viewportW: w,
              viewportH: h,
              rotation: 0,
              dataUrl: reader.result as string,
            },
          ]);
          setPendingImgPos(null);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(imgFile);
      e.target.value = "";
    },
    [pendingImgPos, currentPage, viewportToPdf],
  );

  // --- Signature handlers ---

  const handleSigMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSigDrawing(true);
    const canvas = sigCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }, []);

  const handleSigMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!sigDrawing) return;
      const canvas = sigCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext("2d")!;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000";
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
    },
    [sigDrawing],
  );

  const handleSigMouseUp = useCallback(() => {
    setSigDrawing(false);
  }, []);

  const confirmSignature = useCallback(() => {
    if (!sigPos) return;
    const canvas = sigCanvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    const w = 200;
    const h = 70;
    const { pdfX, pdfY } = viewportToPdf(sigPos.x, sigPos.y + h);
    setOverlays((prev) => [
      ...prev,
      {
        id: generateId(),
        type: "signature",
        pageIndex: currentPage,
        pdfX,
        pdfY,
        pdfWidth: w / RENDER_SCALE,
        pdfHeight: h / RENDER_SCALE,
        viewportX: sigPos.x,
        viewportY: sigPos.y,
        viewportW: w,
        viewportH: h,
        rotation: 0,
        dataUrl,
      },
    ]);
    setSigModalOpen(false);
    setSigPos(null);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [sigPos, currentPage, viewportToPdf]);

  // --- Remove overlay ---

  const removeOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    setSelectedOverlayId(null);
  }, []);

  // --- Keyboard delete for overlays ---

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedOverlayId && !sigModalOpen && !watermarkModalOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
        removeOverlay(selectedOverlayId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedOverlayId, sigModalOpen, watermarkModalOpen, removeOverlay]);

  // --- Update text ---

  const updateBlockText = useCallback(
    (pageIndex: number, blockId: string, newText: string) => {
      setPages((prev) =>
        prev.map((p, i) => {
          if (i !== pageIndex) return p;
          return {
            ...p,
            editableBlocks: p.editableBlocks.map((b) =>
              b.id === blockId ? { ...b, text: newText } : b,
            ),
          };
        }),
      );
    },
    [],
  );

  // --- Remove block (restore original text on canvas) ---

  const removeBlock = useCallback(
    async (pageIndex: number, blockId: string) => {
      if (!pdfRef.current) return;
      const pageData = pages[pageIndex];
      if (!pageData) return;

      const remaining = pageData.editableBlocks.filter((b) => b.id !== blockId);
      const newUrl = await renderPageWithErasures(
        pdfRef.current,
        pageData.pageNum,
        remaining,
      );

      setPages((prev) =>
        prev.map((p, i) =>
          i === pageIndex
            ? { ...p, editableBlocks: remaining, canvasUrl: newUrl }
            : p,
        ),
      );
    },
    [pages],
  );

  // --- Save ---

  const handleSave = async () => {
    if (!file || !pdfRef.current) return;
    setSaving(true);

    try {
      const cjkFontBytes = await loadCJKFont();
      const buffer = await file.arrayBuffer();
      const srcPdf = await PDFDocument.load(new Uint8Array(buffer));

      // Build output PDF with the reordered/modified page list
      const outPdf = await PDFDocument.create();
      outPdf.registerFontkit(fontkit);
      const font = await outPdf.embedFont(cjkFontBytes);

      for (let pi = 0; pi < pages.length; pi++) {
        const pageData = pages[pi];
        let outPage;

        if (pageData.sourcePageNum === 0) {
          // Blank page
          const [w, h] = [pageData.viewport.width / RENDER_SCALE, pageData.viewport.height / RENDER_SCALE];
          outPage = outPdf.addPage([w, h]);
        } else {
          // Copy from source
          const [copied] = await outPdf.copyPages(srcPdf, [pageData.sourcePageNum - 1]);
          outPage = outPdf.addPage(copied);
        }

        // --- Apply text edits (only modified blocks) ---
        const blocksToSave = pageData.editableBlocks.filter(
          (b) => b.text.trim() && b.text !== b.originalText,
        );
        for (const block of blocksToSave) {
          const editedLines = block.text.split("\n");
          for (const line of block.lines) {
            const whiteoutW =
              Math.max(line.pdfWidth, line.text.length * line.pdfFontSize * 0.55) + 6;
            outPage.drawRectangle({
              x: line.pdfX - 3,
              y: line.pdfY - line.pdfFontSize * 0.25,
              width: whiteoutW,
              height: line.pdfFontSize * 1.35,
              color: rgb(1, 1, 1),
            });
          }
          for (let li = 0; li < block.lines.length && li < editedLines.length; li++) {
            const lineText = editedLines[li];
            if (!lineText.trim()) continue;
            const origLine = block.lines[li];
            outPage.drawText(lineText, {
              x: origLine.pdfX,
              y: origLine.pdfY,
              size: origLine.pdfFontSize,
              font,
              color: rgb(0, 0, 0),
            });
          }
        }

        // --- Apply overlays for this page ---
        const pageOverlays = overlays.filter((o) => o.pageIndex === pi);
        for (const overlay of pageOverlays) {
          if (overlay.type === "whiteout") {
            outPage.drawRectangle({
              x: overlay.pdfX,
              y: overlay.pdfY,
              width: overlay.pdfWidth,
              height: overlay.pdfHeight,
              color: rgb(1, 1, 1),
            });
          }
          if ((overlay.type === "image" || overlay.type === "signature") && overlay.dataUrl) {
            const base64 = overlay.dataUrl.split(",")[1];
            const binary = atob(base64);
            const imgBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              imgBytes[i] = binary.charCodeAt(i);
            }
            let image;
            if (overlay.dataUrl.includes("image/png")) {
              image = await outPdf.embedPng(imgBytes);
            } else {
              image = await outPdf.embedJpg(imgBytes);
            }
            outPage.drawImage(image, {
              x: overlay.pdfX,
              y: overlay.pdfY,
              width: overlay.pdfWidth,
              height: overlay.pdfHeight,
              rotate: degrees(overlay.rotation),
            });
          }
        }

        // --- Apply watermark ---
        const hasTextWatermark = watermarkText.trim().length > 0;
        const hasImageWatermark = !!watermarkImageDataUrl;

        if (hasTextWatermark) {
          const { width, height } = outPage.getSize();
          const wmWidth = font.widthOfTextAtSize(watermarkText, watermarkFontSize);
          outPage.drawText(watermarkText, {
            x: (width - wmWidth) / 2,
            y: height / 2,
            size: watermarkFontSize,
            font,
            color: rgb(0.5, 0.5, 0.5),
            opacity: watermarkOpacity,
            rotate: degrees(watermarkRotation),
          });
        }

        if (hasImageWatermark && watermarkImageDataUrl) {
          const wmBase64 = watermarkImageDataUrl.split(",")[1];
          const wmBinary = atob(wmBase64);
          const wmBytes = new Uint8Array(wmBinary.length);
          for (let i = 0; i < wmBinary.length; i++) {
            wmBytes[i] = wmBinary.charCodeAt(i);
          }
          let wmImage;
          if (watermarkImageDataUrl.includes("image/png")) {
            wmImage = await outPdf.embedPng(wmBytes);
          } else {
            wmImage = await outPdf.embedJpg(wmBytes);
          }
          const { width, height } = outPage.getSize();
          const wmScale = Math.min(1, (width * 0.4) / wmImage.width);
          const wmW = wmImage.width * wmScale;
          const wmH = wmImage.height * wmScale;
          outPage.drawImage(wmImage, {
            x: (width - wmW) / 2,
            y: (height - wmH) / 2,
            width: wmW,
            height: wmH,
            opacity: watermarkOpacity,
            rotate: degrees(watermarkRotation),
          });
        }
      }

      const result = await outPdf.save();
      const blob = new Blob([result.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      saveAs(blob, file.name.replace(/\.pdf$/i, "_edited.pdf"));
    } catch (err) {
      alert("保存失败: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // --- Derived ---

  const currentData = pages[currentPage];
  const currentOverlays = overlays.filter((o) => o.pageIndex === currentPage);
  const modifiedCount = pages.reduce(
    (sum, p) =>
      sum + p.editableBlocks.filter((b) => b.text !== b.originalText).length,
    0,
  );
  const totalBlocks = pages.reduce(
    (sum, p) => sum + p.editableBlocks.length,
    0,
  );
  const hasAnyEdits = totalBlocks > 0 || overlays.length > 0 || watermarkText.trim().length > 0 || !!watermarkImageDataUrl;

  const cursorStyle =
    tool === "whiteout"
      ? "crosshair"
      : tool === "image" || tool === "signature"
        ? "copy"
        : "crosshair";

  const toolDefs: { id: ToolMode; icon: typeof MousePointerSquareDashed; label: string }[] = [
    { id: "select", icon: MousePointerSquareDashed, label: "选择文字" },
    { id: "whiteout", icon: Eraser, label: "涂白" },
    { id: "image", icon: ImageIcon, label: "插入图片" },
    { id: "signature", icon: Pen, label: "签名" },
    { id: "watermark", icon: Droplets, label: "水印" },
  ];

  // --- Render ---

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-white border-b border-gray-200 flex-shrink-0 overflow-x-auto">
        <button
          onClick={() => {
            setFile(null);
            setPages([]);
            setOverlays([]);
            pdfRef.current = null;
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        {file && (
          <>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            {toolDefs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  if (t.id === "watermark") {
                    setWatermarkModalOpen(true);
                    return;
                  }
                  setTool(t.id);
                  setSelectedOverlayId(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  tool === t.id && t.id !== "watermark"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </>
        )}

        <div className="flex-1 min-w-[20px]" />

        {file && (
          <span className="text-sm text-gray-500 truncate max-w-[250px]">
            {file.name}
          </span>
        )}

        {selectedOverlayId && (
          <button
            onClick={() => removeOverlay(selectedOverlayId)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 whitespace-nowrap"
          >
            <X className="w-4 h-4" />
            删除
          </button>
        )}

        {pages.length > 0 && (
          <div className="flex items-center gap-1 mr-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="px-2 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
            >
              ←
            </button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage + 1} / {pages.length}
            </span>
            <button
              onClick={() =>
                setCurrentPage((p) => Math.min(pages.length - 1, p + 1))
              }
              disabled={currentPage >= pages.length - 1}
              className="px-2 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
            >
              →
            </button>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !file || !hasAnyEdits}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
        >
          <Save className="w-4 h-4" />
          {saving ? "保存中..." : "保存 PDF"}
        </button>
      </div>

      {!file ? (
        <div className="flex-1 p-8 overflow-auto">
          <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-8 h-8 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-900">
                PDF 智能编辑器
              </h2>
            </div>
            <p className="text-gray-500 mb-4">
              集成文字编辑、涂白、插入图片、签名、水印等功能的一体化 PDF 编辑器。
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm text-blue-800">
              <p className="font-medium mb-1">功能一览：</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><b>选择文字</b> — 框选文字区域，原位编辑文字内容</li>
                <li><b>涂白</b> — 拖拽绘制白色遮罩覆盖内容</li>
                <li><b>插入图片</b> — 点击页面位置，上传图片</li>
                <li><b>签名</b> — 点击页面位置，手写签名</li>
                <li><b>水印</b> — 为所有页面添加文字水印</li>
              </ul>
            </div>
            <FileDropzone
              accept=".pdf"
              files={[]}
              onFilesChange={handleFile}
              label="拖拽 PDF 文件到此处，或点击选择"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Page sidebar */}
          <div className="w-48 border-r border-gray-200 bg-gray-50 overflow-y-auto flex-shrink-0 flex flex-col">
            <div className="p-2 space-y-0.5 flex-1 overflow-y-auto">
              {pages.map((p, i) => {
                const blockCount = p.editableBlocks.length;
                const overlayCount = overlays.filter((o) => o.pageIndex === i).length;
                const hasMod = p.editableBlocks.some(
                  (b) => b.text !== b.originalText,
                );
                const isDragOver = dropTargetIdx === i && dragPageIdx !== null && dragPageIdx !== i;
                return (
                  <div
                    key={`page-${i}`}
                    draggable
                    onDragStart={(e) => {
                      setDragPageIdx(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropTargetIdx(i);
                    }}
                    onDragLeave={() => {
                      if (dropTargetIdx === i) setDropTargetIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragPageIdx !== null && dragPageIdx !== i) {
                        reorderPages(dragPageIdx, i);
                      }
                      setDragPageIdx(null);
                      setDropTargetIdx(null);
                    }}
                    onDragEnd={() => {
                      setDragPageIdx(null);
                      setDropTargetIdx(null);
                    }}
                    onClick={() => setCurrentPage(i)}
                    className={`group flex items-start gap-1 px-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                      currentPage === i
                        ? "bg-blue-100 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-100"
                    } ${isDragOver ? "ring-2 ring-blue-400 bg-blue-50" : ""} ${dragPageIdx === i ? "opacity-40" : ""}`}
                  >
                    <GripVertical className="w-3.5 h-3.5 mt-0.5 text-gray-300 group-hover:text-gray-500 cursor-grab flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate">第 {p.pageNum} 页</span>
                        {p.sourcePageNum === 0 && (
                          <span className="text-[10px] text-gray-400 bg-gray-200 px-1 rounded">空白</span>
                        )}
                        {hasMod && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                      </div>
                      {(blockCount > 0 || overlayCount > 0) && (
                        <span className="text-[11px] text-gray-400 block">
                          {blockCount > 0 && `${blockCount} 文本`}
                          {blockCount > 0 && overlayCount > 0 && ", "}
                          {overlayCount > 0 && `${overlayCount} 覆盖`}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                      <button
                        title="复制此页"
                        onClick={(e) => { e.stopPropagation(); duplicatePage(i); }}
                        className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {pages.length > 1 && (
                        <button
                          title="删除此页"
                          onClick={(e) => { e.stopPropagation(); deletePage(i); }}
                          className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-gray-200">
              <button
                onClick={addBlankPage}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加空白页
              </button>
            </div>
          </div>

          {/* Main viewer */}
          <div className="flex-1 overflow-auto bg-gray-100 p-6">
            <div className="flex justify-center min-h-full">
              {currentData && (
                <div
                  ref={containerRef}
                  className="relative bg-white shadow-lg select-none"
                  style={{
                    width: currentData.viewport.width,
                    height: currentData.viewport.height,
                    cursor: cursorStyle,
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => {
                    if (selecting) {
                      setSelecting(false);
                      setSelRect(null);
                      setSelStart(null);
                    }
                    if (whiteoutDrawing) {
                      setWhiteoutDrawing(false);
                      setWhiteoutRect(null);
                    }
                    if (dragAction) {
                      setOverlays((prev) => prev.map((o) => o.id === dragAction.id ? syncOverlayPdf(o) : o));
                      setDragAction(null);
                    }
                  }}
                >
                  {/* PDF background */}
                  <img
                    src={currentData.canvasUrl}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ objectFit: "fill" }}
                    draggable={false}
                    alt=""
                  />

                  {/* Editable text blocks */}
                  {currentData.editableBlocks.map((block) => (
                    <EditableBlock
                      key={block.id}
                      block={block}
                      scale={RENDER_SCALE}
                      onTextChange={(text) =>
                        updateBlockText(currentPage, block.id, text)
                      }
                      onRemove={() => removeBlock(currentPage, block.id)}
                    />
                  ))}

                  {/* Overlay items (whiteout, image, signature) */}
                  {currentOverlays.map((o) => {
                    const isSelected = selectedOverlayId === o.id;
                    const wrapStyle: React.CSSProperties = {
                      left: o.viewportX,
                      top: o.viewportY,
                      width: o.viewportW,
                      height: o.viewportH,
                      transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
                      transformOrigin: "center center",
                    };
                    const handleSize = 8;
                    const handles = ["nw", "ne", "sw", "se", "n", "s", "e", "w"];
                    const handlePos = (h: string): React.CSSProperties => {
                      const s: React.CSSProperties = {
                        position: "absolute",
                        width: handleSize,
                        height: handleSize,
                        background: "white",
                        border: "1.5px solid #3b82f6",
                        borderRadius: h.length === 2 ? "1px" : "50%",
                        zIndex: 30,
                        cursor: `${h}-resize`,
                      };
                      if (h.includes("n")) s.top = -handleSize / 2;
                      if (h.includes("s")) s.bottom = -handleSize / 2;
                      if (h.includes("w")) s.left = -handleSize / 2;
                      if (h.includes("e")) s.right = -handleSize / 2;
                      if (h === "n" || h === "s") { s.left = "50%"; s.marginLeft = -handleSize / 2; }
                      if (h === "e" || h === "w") { s.top = "50%"; s.marginTop = -handleSize / 2; }
                      return s;
                    };

                    return (
                      <div
                        key={o.id}
                        className="absolute"
                        style={wrapStyle}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const pos = getRelativePos(e);
                          startOverlayAction(
                            { type: "move", id: o.id, startX: pos.x, startY: pos.y, origX: o.viewportX, origY: o.viewportY },
                            e,
                          );
                        }}
                      >
                        {/* Content */}
                        {o.type === "whiteout" ? (
                          <div
                            className={`w-full h-full ${isSelected ? "ring-2 ring-blue-500" : "border border-dashed border-gray-300"}`}
                            style={{ background: "white" }}
                          />
                        ) : (
                          <img
                            src={o.dataUrl}
                            className={`w-full h-full ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                            draggable={false}
                            alt=""
                          />
                        )}

                        {/* Controls (only when selected) */}
                        {isSelected && (
                          <>
                            {handles.map((h) => (
                              <div
                                key={h}
                                style={handlePos(h)}
                                onMouseDown={(e) => {
                                  const pos = getRelativePos(e);
                                  startOverlayAction(
                                    { type: "resize", id: o.id, handle: h, startX: pos.x, startY: pos.y, origX: o.viewportX, origY: o.viewportY, origW: o.viewportW, origH: o.viewportH },
                                    e,
                                  );
                                }}
                              />
                            ))}
                            {/* Rotate handle */}
                            <div
                              className="absolute flex items-center justify-center"
                              style={{
                                left: "50%",
                                top: -30,
                                marginLeft: -10,
                                width: 20,
                                height: 20,
                                background: "white",
                                border: "1.5px solid #3b82f6",
                                borderRadius: "50%",
                                cursor: "grab",
                                fontSize: 11,
                                lineHeight: 1,
                                userSelect: "none",
                              }}
                              onMouseDown={(e) => {
                                const pos = getRelativePos(e);
                                const cx = o.viewportX + o.viewportW / 2;
                                const cy = o.viewportY + o.viewportH / 2;
                                const startAngle = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
                                startOverlayAction(
                                  { type: "rotate", id: o.id, centerX: cx, centerY: cy, startAngle, origRotation: o.rotation },
                                  e,
                                );
                              }}
                            >
                              ↻
                            </div>
                            {/* Rotation line */}
                            <div
                              className="absolute"
                              style={{
                                left: "50%",
                                top: -20,
                                width: 1,
                                height: 20,
                                background: "#3b82f6",
                                marginLeft: -0.5,
                                pointerEvents: "none",
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Selection highlight */}
                  {selRect && selRect.w > 2 && selRect.h > 2 && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: selRect.x,
                        top: selRect.y,
                        width: selRect.w,
                        height: selRect.h,
                        background: "rgba(59,130,246,0.18)",
                        borderRadius: "1px",
                      }}
                    />
                  )}

                  {/* Whiteout preview */}
                  {whiteoutRect && whiteoutRect.w > 2 && whiteoutRect.h > 2 && (
                    <div
                      className="absolute pointer-events-none border border-dashed border-red-400"
                      style={{
                        left: whiteoutRect.x,
                        top: whiteoutRect.y,
                        width: whiteoutRect.w,
                        height: whiteoutRect.h,
                        background: "rgba(255,255,255,0.7)",
                      }}
                    />
                  )}

                  {/* Live watermark preview */}
                  {(watermarkText.trim() || watermarkImageDataUrl) && (
                    <div
                      className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden"
                      style={{ zIndex: 5 }}
                    >
                      <div
                        style={{
                          transform: `rotate(${watermarkRotation}deg)`,
                          opacity: watermarkOpacity,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {watermarkText.trim() && (
                          <span
                            style={{
                              fontSize: watermarkFontSize * RENDER_SCALE * 0.5,
                              color: "rgba(128,128,128,1)",
                              whiteSpace: "nowrap",
                              fontFamily: "sans-serif",
                              fontWeight: 500,
                              userSelect: "none",
                            }}
                          >
                            {watermarkText}
                          </span>
                        )}
                        {watermarkImageDataUrl && (
                          <img
                            src={watermarkImageDataUrl}
                            alt=""
                            draggable={false}
                            style={{
                              maxWidth: currentData.viewport.width * 0.4,
                              maxHeight: currentData.viewport.height * 0.4,
                              objectFit: "contain",
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden image file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />

      {/* Signature modal */}
      {sigModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-[500px] max-w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">手写签名</h3>
              <button
                onClick={() => {
                  setSigModalOpen(false);
                  setSigPos(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className="border-2 border-gray-300 rounded-lg bg-white cursor-crosshair touch-none"
              onMouseDown={handleSigMouseDown}
              onMouseMove={handleSigMouseMove}
              onMouseUp={handleSigMouseUp}
              onMouseLeave={handleSigMouseUp}
            >
              <canvas
                ref={sigCanvasRef}
                width={460}
                height={200}
                className="block rounded-lg w-full"
                style={{ maxWidth: 460, height: 200 }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  const ctx = sigCanvasRef.current!.getContext("2d")!;
                  ctx.clearRect(0, 0, sigCanvasRef.current!.width, sigCanvasRef.current!.height);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                清空
              </button>
              <button
                onClick={confirmSignature}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                <Check className="w-4 h-4" />
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden watermark image input */}
      <input
        ref={watermarkFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => setWatermarkImageDataUrl(reader.result as string);
          reader.readAsDataURL(f);
          e.target.value = "";
        }}
      />

      {/* Watermark modal */}
      {watermarkModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-[500px] max-w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">添加水印</h3>
              <button
                onClick={() => setWatermarkModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Text watermark */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文字水印</label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="输入水印文字（可留空仅用图片水印）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {watermarkText.trim() && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">字号</label>
                    <input
                      type="number"
                      value={watermarkFontSize}
                      onChange={(e) => setWatermarkFontSize(Number(e.target.value))}
                      min={10}
                      max={200}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">透明度</label>
                    <input
                      type="number"
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                      min={0.1}
                      max={1}
                      step={0.1}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">旋转角度</label>
                    <input
                      type="number"
                      value={watermarkRotation}
                      onChange={(e) => setWatermarkRotation(Number(e.target.value))}
                      min={-180}
                      max={180}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* Image watermark */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">图片水印</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => watermarkFileRef.current?.click()}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                  >
                    {watermarkImageDataUrl ? "更换图片" : "选择图片"}
                  </button>
                  {watermarkImageDataUrl && (
                    <div className="flex items-center gap-2">
                      <img
                        src={watermarkImageDataUrl}
                        className="h-10 rounded border"
                        style={{ opacity: watermarkOpacity }}
                        alt="watermark preview"
                      />
                      <button
                        onClick={() => setWatermarkImageDataUrl(null)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        移除
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  图片将以设定的透明度作为水印居中添加到每一页
                </p>
              </div>

              {!watermarkText.trim() && watermarkImageDataUrl && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">透明度</label>
                    <input
                      type="number"
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                      min={0.1}
                      max={1}
                      step={0.1}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">旋转角度</label>
                    <input
                      type="number"
                      value={watermarkRotation}
                      onChange={(e) => setWatermarkRotation(Number(e.target.value))}
                      min={-180}
                      max={180}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {(watermarkText.trim() || watermarkImageDataUrl) && (
                <p className="text-xs text-green-600">
                  ✓ 水印已设置，保存 PDF 时将应用到所有页面
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setWatermarkText("");
                  setWatermarkImageDataUrl(null);
                  setWatermarkModalOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                清除全部
              </button>
              <button
                onClick={() => setWatermarkModalOpen(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                <Check className="w-4 h-4" />
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
