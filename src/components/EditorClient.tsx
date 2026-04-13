"use client";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => <div className="p-12 text-gray-400 text-sm">Chargement…</div>,
});

export default function EditorClient(props: React.ComponentProps<typeof Editor>) {
  return <Editor {...props} />;
}
