"use client";
import { useEffect } from "react";

export default function VisitRecorder({ pageId }: { pageId: string }) {
  useEffect(() => {
    fetch(`/api/pages/${pageId}/visit`, { method: "POST" });
  }, [pageId]);

  return null;
}
