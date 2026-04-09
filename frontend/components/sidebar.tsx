"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menus = [
  { href: "/books", label: "书库管理" },
  { href: "/tasks", label: "仿写任务" },
  { href: "/create-tasks", label: "原创创作" },
  { href: "/framework-tasks", label: "原创创作（框架）" },
  { href: "/featured-notes", label: "精选笔记" },
  { href: "/batches", label: "批次页" },
  { href: "/prompts", label: "Prompt 配置中心" }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">xhsocr</div>
      <nav className="menu">
        {menus.map((menu) => {
          const active = pathname === menu.href || pathname.startsWith(`${menu.href}/`);
          return (
            <Link key={menu.href} href={menu.href} className={`menuItem ${active ? "active" : ""}`}>
              {menu.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
