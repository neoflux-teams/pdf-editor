import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import MergePDF from "./pages/MergePDF";
import SplitPDF from "./pages/SplitPDF";
import RotatePages from "./pages/RotatePages";
import PDFToImages from "./pages/PDFToImages";
import ImageToPDF from "./pages/ImageToPDF";
import SmartEditor from "./pages/SmartEditor";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/merge" element={<MergePDF />} />
        <Route path="/split" element={<SplitPDF />} />
        <Route path="/rotate" element={<RotatePages />} />
        <Route path="/pdf-to-images" element={<PDFToImages />} />
        <Route path="/image-to-pdf" element={<ImageToPDF />} />
        <Route path="/editor" element={<SmartEditor />} />
      </Routes>
    </Layout>
  );
}
