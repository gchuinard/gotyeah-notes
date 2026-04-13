import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import SearchPalette from "@/components/SearchPalette";

export const metadata: Metadata = {
  title: "Notes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      {/* Évite le flash lors du rechargement en mode sombre */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')`,
          }}
        />
      </head>
      <body className="flex h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <SearchPalette />
      </body>
    </html>
  );
}
