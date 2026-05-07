import { useState } from "react";
import { FileImage, Download, Loader2 } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import { imagesToPDF, downloadPDF } from "@/lib/pdf";

export default function ImageToPDF() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  const handleConvert = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const result = await imagesToPDF(files);
      downloadPDF(result, "images.pdf");
    } catch (error) {
      alert("转换失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <FileImage className="w-6 h-6 text-teal-600" />
          图片转 PDF
        </h2>
        <p className="text-gray-500">将多张图片合并为 PDF 文件</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <FileDropzone
          accept="image/png,image/jpeg"
          multiple
          files={files}
          onFilesChange={setFiles}
          label="拖拽图片到此处（支持 PNG 和 JPEG）"
        />

        {files.length > 0 && (
          <>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-24 object-cover"
                  />
                  <p className="text-xs text-gray-500 px-2 py-1 truncate">
                    {file.name}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={handleConvert}
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  正在转换...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  合并为 PDF
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
