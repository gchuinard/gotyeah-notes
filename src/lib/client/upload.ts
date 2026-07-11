/**
 * uploadFile pour BlockNote : envoie le fichier à POST /api/upload et renvoie l'URL
 * `/api/files/<name>` à embarquer dans le document. Utilisé par l'éditeur de page et
 * les éditeurs du RecordPanel (coller une capture d'écran, glisser une image…).
 */
export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Échec de l'upload");
  }
  const { url } = await res.json();
  return url as string;
}
