import { useState } from "react";
import { Image, Loader2, Download } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import { pdfToImages } from "@/lib/pdf";

export default function PDFToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const onFilesChange = async (files: File[]) => {
    const f = files[0] || null;
    setFile(f);
    setImages([]);
  };

  const handleConvert = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const result = await pdfToImages(file, 2);
      setImages(result);
    } catch (error) {
      alert("转换失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = (dataUrl: string, index: number) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `page_${String(index + 1).padStart(3, "0")}.png`;
    link.click();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Image className="w-6 h-6 text-pink-600" />
          PDF 转图片
        </h2>
        <p className="text-gray-500">将 PDF 每页导出为 PNG 图片</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <FileDropzone
          accept=".pdf"
          files={file ? [file] : []}
          onFilesChange={onFilesChange}
          label="选择一个 PDF 文件"
        />

        {file && images.length === 0 && (
          <button
            onClick={handleConvert}
            disabled={loading}
            className="w-full bg-pink-600 hover:bg-pink-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在转换...
              </>
            ) : (
              <>
                <Image className="w-5 h-5" />
                开始转换
              </>
            )}
          </button>
        )}

        {images.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">共 {images.length} 页</p>
              <button
                onClick={() => images.forEach(downloadImage)}
                className="text-sm text-pink-600 hover:text-pink-700 font-medium flex items-center gap-1"
              >
                <Download className="w-4 h-4" />
                下载全部
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {images.map((img, i) => (
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg overflow-hidden group cursor-pointer"
                  onClick={() => downloadImage(img, i)}
                >
                  <img
                    src={img}
                    alt={`Page ${i + 1}`}
                    className="w-full h-auto"
                  />
                  <div className="px-3 py-2 bg-gray-50 flex items-center justify-between group-hover:bg-gray-100 transition-colors">
                    <span className="text-xs text-gray-600">
                      第 {i + 1} 页
                    </span>
                    <Download className="w-3 h-3 text-gray-400 group-hover:text-pink-600" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
