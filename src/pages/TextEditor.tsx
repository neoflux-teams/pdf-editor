import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { FileText, Download, ArrowLeft } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { saveAs } from "file-saver";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PageText {
  pageNum: number;
  text: string;
}

export default function TextEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [pageTexts, setPageTexts] = useState<PageText[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "点击此处编辑文本内容...",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] p-4",
      },
    },
  });

  // Load PDF text
  const handleFile = useCallback(
    async (files: File[]) => {
      if (!files[0]) return;
      const f = files[0];
      setFile(f);
      setLoading(true);
      setPageTexts([]);

      try {
        const buffer = await f.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        const results: PageText[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          // Group text items by vertical position (y coordinate)
          const items = textContent.items as any[];
          const lines: Map<number, string[]> = new Map();

          for (const item of items) {
            if (!item.str) continue;
            // Round y to nearest 2px to group nearby text into lines
            const yKey = Math.round(item.transform[5] / 2) * 2;
            if (!lines.has(yKey)) lines.set(yKey, []);
            lines.get(yKey)!.push(item.str);
          }

          // Sort by y descending (top to bottom in PDF coords)
          const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);
          const paragraphs: string[] = [];
          let currentPara = "";

          for (const y of sortedY) {
            const lineText = lines.get(y)!.join(" ").trim();
            if (!lineText) continue;

            // Heuristic: if line ends with punctuation or is short, it might be end of paragraph
            const endsWithBreak = /[。！？.!?;；]$/.test(lineText);
            const isShort = lineText.length < 40;

            if (currentPara) {
              currentPara += " " + lineText;
            } else {
              currentPara = lineText;
            }

            if (endsWithBreak || isShort) {
              paragraphs.push(currentPara);
              currentPara = "";
            }
          }
          if (currentPara) paragraphs.push(currentPara);

          const pageText = paragraphs.join("\n\n");
          results.push({ pageNum: i, text: pageText });
        }

        setPageTexts(results);

        // Build initial editor content
        const html = results
          .map(
            (p) =>
              `<h3>第 ${p.pageNum} 页</h3><p>${p.text.replace(/\n\n/g, "</p><p>")}</p>`
          )
          .join("");

        editor?.commands.setContent(html);
      } catch (err) {
        alert("提取文本失败: " + (err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [editor]
  );

  // Export to PDF
  const handleExport = async () => {
    if (!editor || !file) return;
    setExporting(true);
    try {
      const html = editor.getHTML();
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

      // Simple HTML parsing to extract text
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const body = doc.body;

      const pageWidth = 595; // A4 points
      const pageHeight = 842;
      const margin = 50;
      const lineHeight = 16;
      const maxWidth = pageWidth - margin * 2;

      let currentPage = pdf.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      function newPage() {
        currentPage = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }

      function drawText(text: string, size: number, isBold: boolean) {
        const f = isBold ? boldFont : font;
        const words = text.split(/(\s+)/);
        let line = "";

        for (const word of words) {
          const test = line + word;
          const width = f.widthOfTextAtSize(test, size);
          if (width > maxWidth && line) {
            currentPage.drawText(line.trim(), {
              x: margin,
              y,
              size,
              font: f,
              color: rgb(0, 0, 0),
            });
            y -= lineHeight * (size / 12);
            line = word;
            if (y < margin) newPage();
          } else {
            line = test;
          }
        }
        if (line.trim()) {
          currentPage.drawText(line.trim(), {
            x: margin,
            y,
            size,
            font: f,
            color: rgb(0, 0, 0),
          });
          y -= lineHeight * (size / 12);
        }
      }

      function processNode(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || "";
          if (text.trim()) {
            drawText(text, 12, false);
          }
          return;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();

          if (tag === "h1" || tag === "h2" || tag === "h3") {
            y -= 8;
            if (y < margin) newPage();
            drawText(el.textContent || "", 16, true);
            y -= 4;
          } else if (tag === "p") {
            if (el.textContent?.trim()) {
              drawText(el.textContent, 12, false);
              y -= 4;
            }
          } else if (tag === "br") {
            y -= lineHeight;
          } else if (tag === "ul" || tag === "ol") {
            for (const child of Array.from(el.children)) {
              if (child.tagName.toLowerCase() === "li") {
                drawText("• " + (child.textContent || ""), 12, false);
                y -= 2;
              }
            }
          } else {
            for (const child of Array.from(el.childNodes)) {
              processNode(child);
            }
          }

          if (y < margin) newPage();
        }
      }

      for (const child of Array.from(body.childNodes)) {
        processNode(child);
        if (y < margin) newPage();
      }

      const bytes = await pdf.save();
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      saveAs(blob, file.name.replace(/\.pdf$/i, "_edited.pdf"));
    } catch (err) {
      alert("导出失败: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-50">
      {!file ? (
        <div className="flex-1 p-8 overflow-auto">
          <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-8 h-8 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-900">
                PDF 文本提取编辑器
              </h2>
            </div>
            <p className="text-gray-500 mb-6">
              将 PDF
              文本提取到富文本编辑器中修改，然后重新生成排版后的PDF。
              <br />
              <span className="text-sm text-orange-600 mt-1 block">
                注意：此方案会重新排版，适合文字内容为主的文档。
              </span>
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 p-3 bg-white border-b border-gray-200 flex-shrink-0">
            <button
              onClick={() => {
                setFile(null);
                setPageTexts([]);
                editor?.commands.clearContent();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>
            <div className="flex-1" />
            <span className="text-sm text-gray-500 truncate max-w-[200px]">
              {file.name}
            </span>
            <div className="flex-1" />
            <button
              onClick={handleExport}
              disabled={exporting || !editor}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exporting ? "导出中..." : "导出 PDF"}
            </button>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-auto p-4">
            <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-gray-500">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
                  正在提取文本...
                </div>
              ) : (
                <>
                  {/* Tiptap menu bar */}
                  <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-gray-50 flex-wrap">
                    <MenuButton
                      active={editor?.isActive("bold")}
                      onClick={() => editor?.chain().focus().toggleBold().run()}
                      label="B"
                      bold
                    />
                    <MenuButton
                      active={editor?.isActive("italic")}
                      onClick={() =>
                        editor?.chain().focus().toggleItalic().run()
                      }
                      label="I"
                      italic
                    />
                    <div className="w-px h-5 bg-gray-300 mx-1" />
                    <MenuButton
                      active={editor?.isActive("heading", { level: 1 })}
                      onClick={() =>
                        editor?.chain().focus().toggleHeading({ level: 1 }).run()
                      }
                      label="H1"
                    />
                    <MenuButton
                      active={editor?.isActive("heading", { level: 2 })}
                      onClick={() =>
                        editor?.chain().focus().toggleHeading({ level: 2 }).run()
                      }
                      label="H2"
                    />
                    <MenuButton
                      active={editor?.isActive("heading", { level: 3 })}
                      onClick={() =>
                        editor?.chain().focus().toggleHeading({ level: 3 }).run()
                      }
                      label="H3"
                    />
                    <div className="w-px h-5 bg-gray-300 mx-1" />
                    <MenuButton
                      active={editor?.isActive("bulletList")}
                      onClick={() =>
                        editor?.chain().focus().toggleBulletList().run()
                      }
                      label="• 列表"
                    />
                    <MenuButton
                      active={editor?.isActive("orderedList")}
                      onClick={() =>
                        editor?.chain().focus().toggleOrderedList().run()
                      }
                      label="1. 列表"
                    />
                    <div className="w-px h-5 bg-gray-300 mx-1" />
                    <MenuButton
                      onClick={() =>
                        editor?.chain().focus().undo().run()
                      }
                      label="↩ 撤销"
                    />
                    <MenuButton
                      onClick={() =>
                        editor?.chain().focus().redo().run()
                      }
                      label="↪ 重做"
                    />
                  </div>
                  <EditorContent editor={editor} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  active,
  onClick,
  label,
  bold,
  italic,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
      }`}
      style={{
        fontWeight: bold ? "bold" : undefined,
        fontStyle: italic ? "italic" : undefined,
      }}
    >
      {label}
    </button>
  );
}
