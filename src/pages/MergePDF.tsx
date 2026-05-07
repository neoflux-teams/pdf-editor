import { useState } from "react";
import { Merge, Download, Loader2 } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import { mergePDFs, downloadPDF } from "@/lib/pdf";

export default function MergePDF() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  const handleMerge = async () => {
    if (files.length < 2) return;
    setLoading(true);
    try {
      const result = await mergePDFs(files);
      downloadPDF(result, "merged.pdf");
    } catch (error) {
      alert("合并失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Merge className="w-6 h-6 text-blue-600" />
          合并 PDF
        </h2>
        <p className="text-gray-500">将多个 PDF 文件合并为一个</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <FileDropzone
          accept=".pdf"
          multiple
          files={files}
          onFilesChange={setFiles}
          label="拖拽 PDF 文件到此处（可拖拽多个）"
        />

        {files.length >= 2 && (
          <button
            onClick={handleMerge}
            disabled={loading}
            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在合并...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                合并并下载
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
