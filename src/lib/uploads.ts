import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "./prisma";

export const UPLOAD_PURGE_DAYS = 30;

// Types autorisés (le besoin : coller des captures d'écran). mime -> extension.
const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};

/** Dossier de stockage. Prod : UPLOAD_DIR=/data/uploads (volume). Dev : ./data/uploads. */
export function uploadsDir(): string {
  const env = (process.env.UPLOAD_DIR || "").trim();
  return env || path.join(process.cwd(), "data", "uploads");
}

export function extForType(mime: string): string | null {
  return ALLOWED.get(mime) ?? null;
}

/** Anti path-traversal : un nom servi est uniquement `[A-Za-z0-9_-].ext`. */
export function isSafeUploadName(name: string): boolean {
  return /^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name);
}

export function mimeForName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Types acceptés comme PIÈCE JOINTE d'une carte. Liste SÉPARÉE d'`ALLOWED`, et
 * ce n'est pas une redite.
 *
 * ⚠️ Élargir `ALLOWED` ouvrirait `POST /api/upload` aux documents — donc les
 * trois éditeurs BlockNote, donc aussi les PAGES — et ces documents seraient
 * servis par `GET /api/files/[name]`, qui ne vérifie qu'une session et n'est
 * scopé à aucun espace. Le lot creuserait ainsi de sa propre main le trou qu'il
 * ouvre une route scopée pour éviter : deux chemins pour un même PDF, dont un
 * non protégé, sans que la personne sache lequel elle a emprunté.
 *
 * Conséquence assumée : glisser un PDF dans le CORPS d'une page continue
 * d'échouer en 415. C'est la zone « pièces jointes » de la carte qui l'accepte.
 */
export const ATTACHMENT_TYPES = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/zip", "zip"],
  // Les images restent acceptables en pièce jointe : on joint parfois un scan.
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

/**
 * Extension d'un type de PIÈCE JOINTE, ou null si le type est refusé.
 *
 * ⚠️ L'extension vient du MIME, jamais du nom d'origine — et elle est simple :
 * `isSafeUploadName` n'accepte que `[A-Za-z0-9_-]+\.[a-z0-9]+`. Un `.tar.gz`
 * échouerait à être servi, ET serait sauté par la purge (qui applique le même
 * test) : il deviendrait IMMORTEL sur le disque.
 */
export function attachmentExtForType(mime: string): string | null {
  return ATTACHMENT_TYPES.get(mime) ?? null;
}

/**
 * Types qu'on accepte d'afficher DANS le navigateur. Tout le reste est renvoyé
 * en pièce jointe, donc téléchargé au lieu d'être rendu.
 *
 * ⚠️ `image/svg+xml` y figure — un SVG doit continuer de s'afficher dans un
 * `<img>` de l'éditeur, et un `Content-Disposition: attachment` n'y changerait
 * rien (l'en-tête ne vaut que pour une navigation, pas pour une sous-ressource).
 * Ce n'est donc PAS lui qui protège du SVG : c'est la CSP, cf. FILE_CSP.
 */
const INLINE_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * ⚠️ CE QUI FERME LA XSS. Un SVG est un DOCUMENT : il peut porter un `<script>`,
 * et `image/svg+xml` est un type que le navigateur exécute quand on ouvre l'URL
 * directement. `X-Content-Type-Options: nosniff` (posé globalement dans
 * next.config.ts) n'y peut rien — il empêche de DEVINER un autre type, pas
 * d'honorer celui qu'on déclare. Or n'importe quel éditeur peut téléverser un
 * SVG, et l'URL servie est sur l'origine de l'application.
 *
 * `sandbox` sans jeton retire TOUT : scripts, formulaires, et l'origine elle-même
 * (le document devient opaque, donc sans accès aux cookies ni au stockage de
 * l'app). `default-src 'none'` coupe en plus toute sous-ressource que le fichier
 * tenterait de charger — exfiltration comprise.
 *
 * Sans effet sur les images légitimes : une CSP de réponse ne s'applique pas au
 * rendu d'une sous-ressource `<img>`.
 */
export const FILE_CSP = "default-src 'none'; sandbox";

/** En-têtes de service d'un fichier téléversé. Le nom sert au libellé de téléchargement. */
export function fileResponseHeaders(name: string): Record<string, string> {
  const mime = mimeForName(name);
  return {
    "Content-Type": mime,
    "Content-Security-Policy": FILE_CSP,
    // Empêche un autre site d'embarquer nos fichiers (fuite par <img> distant).
    "Cross-Origin-Resource-Policy": "same-origin",
    // Ce qu'on ne sait pas afficher sans risque est téléchargé, jamais rendu.
    ...(INLINE_SAFE.has(mime)
      ? {}
      : { "Content-Disposition": `attachment; filename="${name}"` }),
    "Cache-Control": "private, max-age=86400",
  };
}

/** Noms de fichiers `/api/files/<name>` référencés dans un texte (content sérialisé). */
export function extractUploadRefs(text: string | null): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const re = /\/api\/files\/([A-Za-z0-9_-]+\.[a-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

/**
 * Purge les fichiers d'upload ORPHELINS (non référencés) de plus de 30 j. Scanne
 * Page.content + Record.content/sectionsBody + RecordAttachment.fileName. Ne
 * scanne le contenu QUE s'il existe des fichiers assez vieux (borne le coût).
 * Renvoie le nombre de fichiers purgés.
 *
 * ⚠️ TOUTE NOUVELLE FAÇON DE RÉFÉRENCER UN FICHIER DOIT ÊTRE AJOUTÉE ICI. La
 * fonction est aveugle par construction : elle ne connaît que ce qu'on lui
 * donne. Un fichier référencé ailleurs est vu comme orphelin et `unlink` — 30
 * jours plus tard, donc jamais pendant une recette. `Record.coverUrl` est déjà
 * dans ce cas (sans conséquence : aucune route ne l'écrit).
 *
 * ⚠️ La lecture des pages et des records NE FILTRE PAS `trashedAt` — c'est
 * VOULU. Un élément en corbeille protège encore ses fichiers, sinon restaurer
 * une carte rendrait ses images et ses pièces jointes mortes.
 */
export async function purgeOrphanUploads(now: Date = new Date()): Promise<number> {
  const dir = uploadsDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0; // pas de dossier → rien à purger
  }

  const cutoff = now.getTime() - UPLOAD_PURGE_DAYS * 86_400_000;
  const old: string[] = [];
  for (const name of names) {
    if (!isSafeUploadName(name)) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (st.mtimeMs < cutoff) old.push(name);
    } catch {
      /* fichier disparu entre-temps */
    }
  }
  if (old.length === 0) return 0;

  const referenced = new Set<string>();
  const [pages, records, attachments] = await Promise.all([
    prisma.page.findMany({ select: { content: true } }),
    prisma.record.findMany({ select: { content: true, sectionsBody: true } }),
    prisma.recordAttachment.findMany({ select: { fileName: true } }),
  ]);
  for (const p of pages) for (const n of extractUploadRefs(p.content)) referenced.add(n);
  for (const r of records) {
    for (const n of extractUploadRefs(r.content)) referenced.add(n);
    for (const n of extractUploadRefs(r.sectionsBody)) referenced.add(n);
  }
  // ⚠️ Le nom est ajouté DIRECTEMENT, jamais via extractUploadRefs : le champ
  // contient `uuid.pdf`, pas `/api/files/uuid.pdf`. Passer par la regex rendrait
  // un ensemble VIDE — et la fonction supprimerait alors toutes les pièces
  // jointes de plus de 30 jours, en silence, un mois après leur dépôt.
  //
  // ⚠️ Cet ensemble EST le comptage de références du projet : recalculé en
  // entier à chaque passage, jamais désynchronisé. C'est lui qui rend gratuite
  // la duplication d'une carte — deux lignes citant le même fichier le
  // protègent, la dernière retirée le libère.
  for (const a of attachments) referenced.add(a.fileName);

  let purged = 0;
  for (const name of old) {
    if (referenced.has(name)) continue;
    try {
      await fs.unlink(path.join(dir, name));
      purged++;
    } catch {
      /* course : déjà supprimé */
    }
  }
  return purged;
}
