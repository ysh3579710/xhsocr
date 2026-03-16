import type { Metadata } from "next";
import { Sidebar } from "../components/sidebar";
import "./styles.css";

export const metadata: Metadata = {
  title: "xhsocr Admin",
  description: "xhsocr MVP admin console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <Sidebar />
          <section className="content">{children}</section>
        </div>
      </body>
    </html>
  );
}
