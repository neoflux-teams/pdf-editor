import { useState } from "react";
import { Scissors, Download, Loader2 } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import { splitPDF, getPDFPageCount } from "@/lib/pdf";
import { saveAs } from "file-saver";

export default function SplitPDF() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [ranges, setRanges] = useState("");
  const [loading, setLoading] = useState(false);

  const onFilesChange = async (files: File[]) => {
    if (files.length > 0) {
      const f = files[0];
      setFile(f);
      try {
        const count = await getPDFPageCount(f);
        setPageCount(count);
      } catch {
        setPageCount(0);
      }
    } else {
      setFile(null);
      setPageCount(0);
    }
  };

  const handleSplit = async () => {
    if (!file || !ranges.trim()) return;
    setLoading(true);
    try {
      const parts: [number, number][] = ranges.split(",").map((r) => {
        const [s, e] = r.trim().split("-").map(Number);
        return [s - 1, (e || s) - 1];
      });
      const results = await splitPDF(file, parts);
      results.forEach((bytes, i) => {
        const blob = new Blob([bytes.buffer], { type: "application/pdf" });
        saveAs(blob, `split_part_${i + 1}.pdf`);
      });
    } catch (error) {
      alert("拆分失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Scissors className="w-6 h-6 text-green-600" />
          拆分 PDF
        </h2>
        <p className="text-gray-500">按页码范围拆分 PDF 文件</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <FileDropzone
          accept=".pdf"
          files={file ? [file] : []}
          onFilesChange={onFilesChange}
          label="选择一个 PDF 文件"
        />

        {pageCount > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              页码范围（共 {pageCount} 页）
            </label>
            <p className="text-sm text-gray-500 mb-2">
              格式: 1-3,5,7-9（表示拆分为 1-3 页、第 5 页、7-9 页三个文件）
            </p>
            <input
              type="text"
              value={ranges}
              onChange={(e) => setRanges(e.target.value)}
              placeholder="例如: 1-3,5,7-9"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {file && ranges.trim() && (
          <button
            onClick={handleSplit}
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在拆分...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                拆分并下载
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
