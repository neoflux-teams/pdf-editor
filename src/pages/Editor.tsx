import { useState, useEffect, useRef, useCallback } from "react";
import {
  Save,
  MousePointer,
  Type,
  Eraser,
  Image as ImageIcon,
  Pen,
  Trash2,
  X,
  Check,
} from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import * as pdfjsLib from "pdfjs-dist";
import { applyOverlays, Overlay, downloadPDF } from "@/lib/pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const RENDER_SCALE = 2;

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function getMousePos(e: React.MouseEvent, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    bottom: rect.height - (e.clientY - rect.top),
    containerHeight: rect.height,
    containerWidth: rect.width,
  };
}

type Tool = "select" | "text" | "whiteout" | "image" | "signature";

export default function Editor() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Text editing
  const [tempText, setTempText] = useState<{
    id: string;
    x: number;
    y: number;
    text: string;
    fontSize: number;
    pageIndex: number;
  } | null>(null);
  const [editingText, setEditingText] = useState("");

  // Whiteout drawing
  const [whiteoutDrawing, setWhiteoutDrawing] = useState(false);
  const [whiteoutStart, setWhiteoutStart] = useState({ x: 0, y: 0 });
  const [whiteoutRect, setWhiteoutRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // Dragging
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number;
    offsetBottom: number;
  } | null>(null);

  // Signature modal
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [sigPos, setSigPos] = useState<{ x: number; y: number } | null>(null);
  const [sigDrawing, setSigDrawing] = useState(false);

  // Image upload
  const [pendingImgPos, setPendingImgPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Load PDF
  const handleFile = async (files: File[]) => {
    if (!files[0]) return;
    const f = files[0];
    const buffer = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    setFile(f);
    setPdfDoc(pdf);
    setPageCount(pdf.numPages);
    setCurrentPage(1);
    setOverlays([]);
    setSelectedId(null);
    setTempText(null);

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    setPageSize({ width: viewport.width, height: viewport.height });
  };

  // Render page
  useEffect(() => {
    if (!pdfDoc) return;
    const render = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setPageSize({
        width: viewport.width / RENDER_SCALE,
        height: viewport.height / RENDER_SCALE,
      });
    };
    render();
  }, [pdfDoc, currentPage]);

  // Auto-focus text input
  useEffect(() => {
    if (tempText && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [tempText]);

  // Keyboard delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedId && !tempText && !sigModalOpen) {
        setOverlays((prev) => prev.filter((o) => o.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, tempText, sigModalOpen]);

  // Save PDF
  const handleSave = async () => {
    if (!file) return;
    setTool("select");
    setSelectedId(null);
    setTempText(null);
    try {
      const currentOverlays = overlays.filter(
        (o) => o.pageIndex === currentPage - 1,
      );
      const result = await applyOverlays(file, currentOverlays);
      downloadPDF(result, "edited.pdf");
    } catch (error) {
      alert("保存失败: " + (error as Error).message);
    }
  };

  // Mouse down on container
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current || !file) return;
    const pos = getMousePos(e, containerRef.current);

    if (tool === "select") {
      // Check if clicked on an overlay
      const currentOverlays = overlays.filter(
        (o) => o.pageIndex === currentPage - 1,
      );
      for (const o of currentOverlays) {
        const domLeft = o.x * RENDER_SCALE;
        const domBottom = o.y * RENDER_SCALE;
        let domW = 0,
          domH = 0;
        if (o.type === "text") {
          domW = o.width * RENDER_SCALE;
          domH = o.height * RENDER_SCALE;
        } else if (o.type === "whiteout") {
          domW = o.width * RENDER_SCALE;
          domH = o.height * RENDER_SCALE;
        } else {
          domW = o.width * RENDER_SCALE;
          domH = o.height * RENDER_SCALE;
        }
        const domTop = pos.containerHeight - domBottom - domH;
        if (
          pos.x >= domLeft &&
          pos.x <= domLeft + domW &&
          pos.y >= domTop &&
          pos.y <= domTop + domH
        ) {
          setSelectedId(o.id);
          setDragging({
            id: o.id,
            offsetX: pos.x - domLeft,
            offsetBottom: pos.bottom - domBottom,
          });
          return;
        }
      }
      setSelectedId(null);
      return;
    }

    if (tool === "text") {
      const id = generateId();
      setTempText({
        id,
        x: pos.x / RENDER_SCALE,
        y: pos.bottom / RENDER_SCALE,
        text: "",
        fontSize: 16,
        pageIndex: currentPage - 1,
      });
      setEditingText("");
      setTool("select");
      return;
    }

    if (tool === "whiteout") {
      setWhiteoutDrawing(true);
      setWhiteoutStart({ x: pos.x, y: pos.y });
      setWhiteoutRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }

    if (tool === "image") {
      setPendingImgPos({ x: pos.x / RENDER_SCALE, y: pos.bottom / RENDER_SCALE });
      fileInputRef.current?.click();
      setTool("select");
      return;
    }

    if (tool === "signature") {
      setSigPos({ x: pos.x / RENDER_SCALE, y: pos.bottom / RENDER_SCALE });
      setSigModalOpen(true);
      setTool("select");
      return;
    }
  };

  // Mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const pos = getMousePos(e, containerRef.current);

    if (dragging) {
      e.preventDefault();
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id !== dragging.id) return o;
          return {
            ...o,
            x: (pos.x - dragging.offsetX) / RENDER_SCALE,
            y: (pos.bottom - dragging.offsetBottom) / RENDER_SCALE,
          };
        }),
      );
      return;
    }

    if (whiteoutDrawing && whiteoutRect) {
      e.preventDefault();
      setWhiteoutRect({
        x: Math.min(whiteoutStart.x, pos.x),
        y: Math.min(whiteoutStart.y, pos.y),
        w: Math.abs(pos.x - whiteoutStart.x),
        h: Math.abs(pos.y - whiteoutStart.y),
      });
    }
  };

  // Mouse up
  const handleMouseUp = () => {
    if (dragging) {
      setDragging(null);
      return;
    }

    if (whiteoutDrawing && whiteoutRect) {
      setWhiteoutDrawing(false);
      if (whiteoutRect.w > 5 && whiteoutRect.h > 5) {
        const containerH = containerRef.current!.getBoundingClientRect().height;
        const screenBottom = whiteoutRect.y + whiteoutRect.h;
        const pdfX = whiteoutRect.x / RENDER_SCALE;
        const pdfY = (containerH - screenBottom) / RENDER_SCALE;
        const pdfW = whiteoutRect.w / RENDER_SCALE;
        const pdfH = whiteoutRect.h / RENDER_SCALE;
        setOverlays((prev) => [
          ...prev,
          {
            id: generateId(),
            type: "whiteout" as const,
            pageIndex: currentPage - 1,
            x: pdfX,
            y: pdfY,
            width: pdfW,
            height: pdfH,
          },
        ]);
      }
      setWhiteoutRect(null);
    }
  };

  // Confirm text overlay
  const confirmText = () => {
    if (!tempText) return;
    const text = editingText;
    if (text.trim()) {
      const lines = text.split("\n").length;
      const maxLineLen = Math.max(...text.split("\n").map((l) => l.length));
      const estWidth = Math.max(maxLineLen * tempText.fontSize * 0.6 + 20, 50);
      const estHeight = tempText.fontSize * 1.4 * lines;
      setOverlays((prev) => [
        ...prev,
        {
          id: tempText.id,
          type: "text" as const,
          pageIndex: tempText.pageIndex,
          x: tempText.x,
          y: tempText.y,
          text: text.trim(),
          fontSize: tempText.fontSize,
          width: estWidth / RENDER_SCALE,
          height: estHeight / RENDER_SCALE,
        },
      ]);
    }
    setTempText(null);
    setEditingText("");
  };

  const cancelText = () => {
    setTempText(null);
    setEditingText("");
  };

  // Image upload
  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imgFile = e.target.files?.[0];
    if (!imgFile || !pendingImgPos) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 200;
        const scale = Math.min(1, maxW / img.width);
        const w = img.width * scale;
        const h = img.height * scale;
        setOverlays((prev) => [
          ...prev,
          {
            id: generateId(),
            type: "image" as const,
            pageIndex: currentPage - 1,
            x: pendingImgPos.x,
            y: pendingImgPos.y,
            width: w / RENDER_SCALE,
            height: h / RENDER_SCALE,
            dataUrl: reader.result as string,
          },
        ]);
        setPendingImgPos(null);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(imgFile);
    e.target.value = "";
  };

  // Signature canvas handlers
  const handleSigMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setSigDrawing(true);
    const canvas = sigCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleSigMouseMove = (e: React.MouseEvent) => {
    if (!sigDrawing) return;
    const canvas = sigCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d")!;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const handleSigMouseUp = () => {
    setSigDrawing(false);
  };

  const confirmSignature = () => {
    if (!sigPos) return;
    const canvas = sigCanvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    setOverlays((prev) => [
      ...prev,
      {
        id: generateId(),
        type: "signature" as const,
        pageIndex: currentPage - 1,
        x: sigPos.x,
        y: sigPos.y,
        width: 150 / RENDER_SCALE,
        height: 50 / RENDER_SCALE,
        dataUrl,
      },
    ]);
    setSigModalOpen(false);
    setSigPos(null);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Current page overlays
  const currentOverlays = overlays.filter(
    (o) => o.pageIndex === currentPage - 1,
  );

  // Tool definitions
  const tools: { id: Tool; icon: typeof MousePointer; label: string }[] = [
    { id: "select", icon: MousePointer, label: "选择" },
    { id: "text", icon: Type, label: "文字" },
    { id: "whiteout", icon: Eraser, label: "涂白" },
    { id: "image", icon: ImageIcon, label: "图片" },
    { id: "signature", icon: Pen, label: "签名" },
  ];

  const cursorStyle =
    tool === "whiteout"
      ? "crosshair"
      : tool === "text" || tool === "image" || tool === "signature"
        ? "text"
        : dragging
          ? "grabbing"
          : "default";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-white border-b border-gray-200 flex-shrink-0 overflow-x-auto">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTool(t.id);
              setSelectedId(null);
              setTempText(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              tool === t.id
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}

        <div className="flex-1 min-w-[20px]" />

        {selectedId && (
          <button
            onClick={() => {
              setOverlays((prev) => prev.filter((o) => o.id !== selectedId));
              setSelectedId(null);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-4 h-4" />
            删除
          </button>
        )}

        <button
          onClick={handleSave}
          disabled={!file}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <Save className="w-4 h-4" />
          保存 PDF
        </button>
      </div>

      {/* File drop / Editor */}
      {!file ? (
        <div className="flex-1 p-8 overflow-auto">
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              PDF 覆盖式编辑器
            </h2>
            <p className="text-gray-500 mb-6">
              选择 PDF
              文件开始编辑。支持添加文字、图片、签名和涂白遮罩。所有处理均在浏览器本地完成。
            </p>
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
          {/* Page nav sidebar */}
          <div className="w-44 border-r border-gray-200 bg-gray-50 overflow-y-auto flex-shrink-0">
            <div className="p-2 space-y-1">
              {Array.from({ length: pageCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setCurrentPage(i + 1);
                    setSelectedId(null);
                    setTempText(null);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentPage === i + 1
                      ? "bg-blue-100 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  第 {i + 1} 页
                </button>
              ))}
            </div>
          </div>

          {/* Main editing area */}
          <div className="flex-1 overflow-auto bg-gray-100 p-6">
            <div className="flex items-start justify-center min-h-full">
              <div
                ref={containerRef}
                className="relative bg-white shadow-lg"
                style={{
                  width: pageSize.width * RENDER_SCALE,
                  height: pageSize.height * RENDER_SCALE,
                  cursor: cursorStyle,
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas ref={canvasRef} className="block" />

                {/* Overlays layer */}
                <div className="absolute inset-0 pointer-events-none">
                  {currentOverlays.map((overlay) => {
                    const isSelected = selectedId === overlay.id;
                    const domLeft = overlay.x * RENDER_SCALE;
                    const domBottom = overlay.y * RENDER_SCALE;

                    if (overlay.type === "text") {
                      return (
                        <div
                          key={overlay.id}
                          className={`absolute pointer-events-auto ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                          style={{
                            left: domLeft,
                            bottom: domBottom,
                            fontSize: overlay.fontSize * RENDER_SCALE,
                            lineHeight: 1.4,
                            minWidth: 20,
                            color: "black",
                            userSelect: "none",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {overlay.text}
                        </div>
                      );
                    }

                    if (overlay.type === "whiteout") {
                      return (
                        <div
                          key={overlay.id}
                          className={`absolute bg-white ${isSelected ? "ring-2 ring-blue-500" : "border border-gray-200"}`}
                          style={{
                            left: domLeft,
                            bottom: domBottom,
                            width: overlay.width * RENDER_SCALE,
                            height: overlay.height * RENDER_SCALE,
                          }}
                        />
                      );
                    }

                    if (
                      overlay.type === "image" ||
                      overlay.type === "signature"
                    ) {
                      return (
                        <img
                          key={overlay.id}
                          src={overlay.dataUrl}
                          className={`absolute pointer-events-none ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                          style={{
                            left: domLeft,
                            bottom: domBottom,
                            width: overlay.width * RENDER_SCALE,
                            height: overlay.height * RENDER_SCALE,
                          }}
                          draggable={false}
                          alt=""
                        />
                      );
                    }

                    return null;
                  })}

                  {/* Temporary text input */}
                  {tempText && tempText.pageIndex === currentPage - 1 && (
                    <div
                      className="absolute pointer-events-auto flex flex-col gap-1"
                      style={{
                        left: tempText.x * RENDER_SCALE,
                        bottom: tempText.y * RENDER_SCALE,
                        zIndex: 50,
                      }}
                    >
                      <textarea
                        ref={textInputRef}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            confirmText();
                          }
                        }}
                        className="bg-white/95 border-2 border-blue-500 rounded px-2 py-1 outline-none resize-none min-w-[160px] min-h-[40px] text-sm"
                        style={{ fontSize: tempText.fontSize * RENDER_SCALE }}
                        autoFocus
                        rows={2}
                        placeholder="输入文字..."
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={confirmText}
                          className="flex-1 px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                        >
                          确认
                        </button>
                        <button
                          onClick={cancelText}
                          className="flex-1 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Whiteout preview */}
                  {whiteoutRect && (
                    <div
                      className="absolute bg-white/80 border border-red-400 border-dashed pointer-events-none"
                      style={{
                        left: whiteoutRect.x,
                        top: whiteoutRect.y,
                        width: whiteoutRect.w,
                        height: whiteoutRect.h,
                      }}
                    />
                  )}
                </div>
              </div>
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
                  ctx.clearRect(
                    0,
                    0,
                    sigCanvasRef.current!.width,
                    sigCanvasRef.current!.height,
                  );
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
    </div>
  );
}
