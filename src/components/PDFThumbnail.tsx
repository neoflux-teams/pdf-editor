import { useEffect, useState } from "react";
import { renderPDFPage } from "@/lib/pdf";

interface Props {
  file: File;
  pageNumber: number;
  scale?: number;
  className?: string;
}

export default function PDFThumbnail({
  file,
  pageNumber,
  scale = 0.5,
  className = "",
}: Props) {
  const [src, setSrc] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    renderPDFPage(file, pageNumber, scale).then((dataUrl) => {
      if (!cancelled) {
        setSrc(dataUrl);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber, scale]);

  if (loading) {
    return (
      <div
        className={`aspect-[3/4] bg-gray-100 animate-pulse flex items-center justify-center rounded-lg ${className}`}
      >
        <span className="text-gray-400 text-xs">加载中</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Page ${pageNumber}`}
      className={`w-full rounded-lg ${className}`}
    />
  );
}
