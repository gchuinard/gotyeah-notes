/**
 * Le fetcher SWR du projet. UNE définition, pas dix-neuf.
 *
 * ⚠️ `if (!r.ok) throw` est la raison d'être du module, pas un détail de style.
 * Sans ce test, une réponse d'ERREUR devient la DONNÉE : un 404 rend
 * `{ error: "Not found" }`, que SWR expose comme `data` et non comme `error`.
 * Un composant qui attend un tableau reçoit alors un objet — `data.map(...)`
 * casse, ou rend n'importe quoi. Le défaut est LATENT : invisible tant que tout
 * répond 200, il ne se réveille qu'au moment où l'on aurait le plus besoin que
 * l'écran dise la vérité (accès perdu, carte mise à la corbeille sous les yeux
 * de l'utilisateur, redéploiement en cours).
 *
 * ⚠️ Ce fichier vit dans `lib/client/` : il ne doit JAMAIS être importé depuis
 * une route API ni un Server Component.
 *
 * L'historique explique la duplication : le bon patron existait déjà 8 fois dans
 * le dépôt, le mauvais 11 fois. Deux variantes du même geste, recopiées à la
 * main, qui ont dérivé. Importer d'ici est ce qui empêche la dérive de revenir.
 */
/** Erreur HTTP portant son statut — le message seul obligerait à le re-parser. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  // ⚠️ Le corps de l'erreur n'est PAS lu : le récupérer inviterait à le rendre à
  // l'écran, c'est-à-dire à retomber dans le défaut qu'on ferme. Le `status`
  // suffit à distinguer « session expirée » de « disparu ».
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
};

/**
 * Message court et honnête pour un échec de chargement. Rendu à l'utilisateur,
 * donc jamais un code nu : « HTTP 404 » ne dit rien à qui lit un board.
 */
export function loadErrorMessage(err: unknown): string {
  const status = err instanceof HttpError ? err.status : 0;
  if (status === 401) return "Session expirée — recharge la page.";
  if (status === 403) return "Accès refusé.";
  if (status === 404) return "Introuvable — l'élément a peut-être été supprimé.";
  return "Chargement impossible — vérifie ta connexion.";
}

/**
 * ⚠️ À passer en 3e argument de `useSWR` sur les clés qui peuvent légitimement
 * répondre 4xx. Sans ça, le défaut `shouldRetryOnError` relance en boucle, avec
 * backoff, sur une carte mise à la corbeille ou une session expirée — du bruit
 * réseau qui ne guérira jamais. On réessaie une panne, pas un refus.
 */
export const noRetryOn4xx = {
  onErrorRetry: (
    err: unknown,
    _key: string,
    _config: unknown,
    revalidate: (opts: { retryCount: number }) => void,
    { retryCount }: { retryCount: number }
  ) => {
    const status = err instanceof HttpError ? err.status : 0;
    if (status >= 400 && status < 500) return;
    if (retryCount >= 3) return;
    setTimeout(() => revalidate({ retryCount }), 2000 * 2 ** retryCount);
  },
};
