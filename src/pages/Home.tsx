import { Link } from "react-router-dom";
import {
  Merge,
  Scissors,
  RotateCw,
  Image,
  FileImage,
  Wand2,
} from "lucide-react";

const tools = [
  {
    path: "/editor",
    icon: Wand2,
    title: "PDF 智能编辑器",
    desc: "文字编辑、涂白、插入图片、签名、水印，一站式编辑",
    color: "bg-blue-600",
  },
  {
    path: "/merge",
    icon: Merge,
    title: "合并 PDF",
    desc: "将多个 PDF 合并为一个文件",
    color: "bg-blue-500",
  },
  {
    path: "/split",
    icon: Scissors,
    title: "拆分 PDF",
    desc: "按页码范围拆分 PDF 文件",
    color: "bg-green-500",
  },
  {
    path: "/rotate",
    icon: RotateCw,
    title: "旋转页面",
    desc: "旋转 PDF 中的指定页面",
    color: "bg-purple-500",
  },
  {
    path: "/pdf-to-images",
    icon: Image,
    title: "PDF 转图片",
    desc: "将 PDF 每页导出为 PNG 图片",
    color: "bg-pink-500",
  },
  {
    path: "/image-to-pdf",
    icon: FileImage,
    title: "图片转 PDF",
    desc: "将多张图片合并为 PDF 文件",
    color: "bg-teal-500",
  },
];

export default function Home() {
  return (
    <div>
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          纯前端 PDF 编辑工具
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          所有文件处理均在浏览器本地完成，无需上传到服务器，完全保护您的隐私
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <Link
            key={tool.path}
            to={tool.path}
            className="group bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg hover:border-blue-200 transition-all"
          >
            <div
              className={`w-12 h-12 ${tool.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
            >
              <tool.icon className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {tool.title}
            </h3>
            <p className="text-sm text-gray-500">{tool.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
