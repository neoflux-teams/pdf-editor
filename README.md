# PDF 智能编辑器

纯前端 PDF 编辑工具，无需后端服务，所有处理在浏览器中完成。

## 功能特性

### 核心功能

#### 📝 PDF 智能编辑器
- **文字编辑**：自动识别 PDF 文字位置，在原位直接修改文字内容，保留原有排版和字体样式
- **涂白覆盖**：拖拽绘制白色矩形遮罩，覆盖不需要的内容
- **插入图片**：在 PDF 任意位置插入图片，支持拖拽移动、缩放、旋转
- **手写签名**：内置手写签名板，支持自定义签名并插入到 PDF
- **水印功能**：支持文字水印和图片水印，可设置透明度和旋转角度，实时预览效果

#### 📄 页面管理
- **删除页面**：删除不需要的 PDF 页面
- **添加空白页**：在任意位置插入空白 PDF 页面
- **复制页面**：复制现有页面（包括覆盖层和编辑内容）
- **拖拽排序**：通过拖拽调整页面顺序，覆盖层自动跟随

#### 🔧 其他工具
- **合并 PDF**：将多个 PDF 文件合并为一个
- **拆分 PDF**：按页码范围拆分 PDF 文件
- **旋转页面**：旋转 PDF 中的指定页面
- **PDF 转图片**：将 PDF 每页导出为 PNG 图片
- **图片转 PDF**：将多张图片合并为 PDF 文件

## 技术亮点

- **纯前端架构**：所有 PDF 处理在浏览器中完成，无需上传文件到服务器，保障数据隐私
- **智能文字识别**：基于 PDF.js 的文本层提取，精确识别文字位置和样式
- **CJK 字体支持**：嵌入 Adobe Source Han Sans CN 字体，完美支持中文、日文、韩文
- **实时预览**：水印、覆盖层等效果实时预览，所见即所得
- **高性能渲染**：使用 Canvas 缓存渲染结果，流畅的编辑体验
- **类型安全**：完整的 TypeScript 类型定义，减少运行时错误

## 技术栈

| 类别 | 技术 |
|------|------|
| **前端框架** | React 18, TypeScript |
| **构建工具** | Vite 5 |
| **UI 样式** | TailwindCSS, PostCSS, Autoprefixer |
| **路由** | React Router 6 |
| **PDF 处理** | PDF.js (渲染), pdf-lib (修改) |
| **字体支持** | @pdf-lib/fontkit |
| **图标库** | Lucide React |
| **文件下载** | file-saver |

## 快速开始

### 环境要求

- Node.js >= 18
- npm 或 pnpm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 `http://localhost:5174` 查看应用。

### 生产构建

```bash
npm run build
```

构建产物位于 `dist/` 目录。

### 预览生产构建

```bash
npm run preview
```

## 部署方式

### 静态托管

项目构建后为纯静态文件，可部署到任意静态托管服务：

- **Vercel**
- **Netlify**
- **GitHub Pages**
- **Nginx / Apache**

### Nginx 示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Docker 部署

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## 项目结构

```
pdf-editor/
├── src/
│   ├── components/    # 公共组件
│   ├── lib/          # 工具函数
│   ├── pages/        # 页面组件
│   │   ├── SmartEditor.tsx    # 智能编辑器
│   │   ├── MergePDF.tsx       # 合并 PDF
│   │   ├── SplitPDF.tsx       # 拆分 PDF
│   │   ├── RotatePages.tsx    # 旋转页面
│   │   ├── PDFToImages.tsx    # PDF 转图片
│   │   └── ImageToPDF.tsx     # 图片转 PDF
│   ├── App.tsx       # 路由配置
│   └── main.tsx      # 入口文件
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── vite.config.ts
```

## 浏览器兼容性

- Chrome/Edge >= 90
- Firefox >= 88
- Safari >= 14

## 注意事项

- **字体加载**：首次加载 CJK 字体时需要从 CDN 下载，可能需要几秒钟
- **大文件处理**：超大 PDF 文件（>100MB）可能会占用较多内存
- **浏览器限制**：某些浏览器对 Canvas 大小有限制，超大页面可能无法正常渲染

## 许可证

MIT License
