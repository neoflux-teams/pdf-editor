import { useState } from "react";
import { Droplets, Download, Loader2 } from "lucide-react";
import FileDropzone from "@/components/FileDropzone";
import { addWatermark, downloadPDF } from "@/lib/pdf";

export default function AddWatermark() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(50);
  const [opacity, setOpacity] = useState(0.3);
  const [rotation, setRotation] = useState(-45);
  const [loading, setLoading] = useState(false);

  const onFilesChange = (files: File[]) => {
    setFile(files[0] || null);
  };

  const handleAdd = async () => {
    if (!file || !text.trim()) return;
    setLoading(true);
    try {
      const result = await addWatermark(file, text, {
        fontSize,
        opacity,
        rotation,
      });
      downloadPDF(result, "watermarked.pdf");
    } catch (error) {
      alert("添加水印失败: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Droplets className="w-6 h-6 text-orange-600" />
          添加水印
        </h2>
        <p className="text-gray-500">为 PDF 每页添加文字水印</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
        <FileDropzone
          accept=".pdf"
          files={file ? [file] : []}
          onFilesChange={onFilesChange}
          label="选择一个 PDF 文件"
        />

        {file && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                水印文字
              </label>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入水印文字"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  字号
                </label>
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  min={10}
                  max={200}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  透明度
                </label>
                <input
                  type="number"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  min={0.1}
                  max={1}
                  step={0.1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  旋转角度
                </label>
                <input
                  type="number"
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  min={-180}
                  max={180}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {text.trim() && (
              <button
                onClick={handleAdd}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    正在添加...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    下载带水印的 PDF
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
