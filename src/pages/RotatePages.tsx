import { useState, useEffect } from "react";
import { RotateCw, Download, Loader2, RotateCcw } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import PDFThumbnail from "@/components/PDFThumbnail";
import { rotatePDFPages, getPDFPageCount, downloadPDF } from "@/lib/pdf";

export default function RotatePages() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rotations, setRotations] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (file) {
      getPDFPageCount(file).then((count) => {
        setPageCount(count);
        setRotations(new Map());
      });
    } else {
      setPageCount(0);
      setRotations(new Map());
    }
  }, [file]);

  const onFilesChange = (files: File[]) => {
    setFile(files[0] || null);
  };

  const rotatePage = (pageIndex: number, degrees: number) => {
    setRotations((prev) => {
      const next = new Map(prev);
      const current = next.get(pageIndex) || 0;
      next.set(pageIndex, current + degrees);
      return next;
    });
  };

  const handleRotate = async () => {
    if (!file || rotations.size === 0) return;
    setLoading(true);
    try {
      const result = await rotatePDFPages(file, rotations);
      downloadPDF(result, "rotated.pdf");
    } catch (error) {
      alert("旋转失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <RotateCw className="w-6 h-6 text-purple-600" />
          旋转页面
        </h2>
        <p className="text-gray-500">旋转 PDF 中的指定页面</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <FileDropzone
          accept=".pdf"
          files={file ? [file] : []}
          onFilesChange={onFilesChange}
          label="选择一个 PDF 文件"
        />

        {pageCount > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.from({ length: pageCount }, (_, i) => {
                const rot = rotations.get(i) || 0;
                return (
                  <div key={i} className="border border-gray-200 rounded-lg p-2">
                    <PDFThumbnail
                      file={file!}
                      pageNumber={i + 1}
                      scale={0.5}
                    />
                    <div className="flex items-center justify-between mt-2 px-1">
                      <span className="text-xs text-gray-500">
                        第 {i + 1} 页
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => rotatePage(i, -90)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-500"
                          title="向左旋转"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => rotatePage(i, 90)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-500"
                          title="向右旋转"
                        >
                          <RotateCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {rot !== 0 && (
                      <p className="text-xs text-center text-purple-600 mt-1">
                        已旋转 {rot}°
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {rotations.size > 0 && (
              <button
                onClick={handleRotate}
                disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    正在处理...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    下载旋转后的 PDF
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
