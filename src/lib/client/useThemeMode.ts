"use client";
import { useEffect, useState } from "react";

/**
 * Déduit le mode (clair/sombre) du thème actif au lieu de maintenir une liste
 * de thèmes : on lit la luminance de `--bg` (défini par `[data-theme]` dans
 * globals.css). Robuste à l'ajout de nouveaux thèmes.
 */
function readMode(): "light" | "dark" {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim()
    .replace("#", "");
  if (bg.length < 6) return "light";
  const r = parseInt(bg.slice(0, 2), 16);
  const g = parseInt(bg.slice(2, 4), 16);
  const b = parseInt(bg.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 ? "dark" : "light";
}

/**
 * Mode courant du thème du site, réactif aux changements de `data-theme`
 * (cf. Settings → Apparence). Sert à aligner BlockNote sur le thème de l'app.
 */
export function useThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const html = document.documentElement;
    setMode(readMode());
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}
