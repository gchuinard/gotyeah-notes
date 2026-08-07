import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { keycloakAdminEnabled, listIdpAccounts } from "@/lib/keycloak";

/**
 * État des comptes d'identité (IdP) des membres de l'espace — LECTURE SEULE.
 *
 * ⚠️ ROUTE SÉPARÉE DE `/members`, à dessein. La clé SWR de `/members` alimente
 * aussi les cellules « utilisateur », les filtres et les graines des colonnes
 * kanban : y greffer un appel à Keycloak ferait dépendre l'ouverture d'un board
 * de la santé de l'IdP — 8 s de timeout, puis un kanban qui, privé de graines,
 * classerait toutes ses cartes en « Membre retiré ». Cet écran-ci est le seul à
 * payer ce coût, et seuls les admins le chargent.
 *
 * ⚠️ N'énumère RIEN. La réponse ne contient que les membres de CET espace, avec
 * un statut ; les autres comptes du realm (les autres sites de l'écosystème, les
 * service accounts des autres clients) sont lus pour le croisement puis jetés.
 */

/**
 * `unknown` n'est pas un détail : quand l'annuaire est tronqué, une adresse
 * absente du lot lu n'est PAS une adresse sans compte. Répondre « aucun compte »
 * ferait cliquer « créer » sur quelqu'un qui en a déjà un — donc fabriquerait un
 * doublon d'identité dans un realm partagé, irréparable depuis notes.
 */
// Non exporté : Next contraint les exports d'un `route.ts` aux handlers et à ses
// options de segment. Le pendant client vit dans SettingsPage.
type IdpMemberStatus = "none" | "pending" | "active" | "suspended" | "unknown";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  // Non configuré n'est pas une panne : c'est le mode par défaut du self-host.
  // Le client s'en sert pour ne pas afficher des boutons qui ne feraient rien.
  if (!keycloakAdminEnabled()) {
    return NextResponse.json({ configured: false, available: false, truncated: false, accounts: [] });
  }

  const directory = await listIdpAccounts();
  if (!directory.ok) {
    // L'IdP est injoignable : on le DIT plutôt que de rendre une liste de
    // « aucun compte », qui se lirait comme un état vérifié.
    console.error(`[idp-directory-failed] workspace=${workspaceId} reason=${directory.reason}`);
    return NextResponse.json({ configured: true, available: false, truncated: false, accounts: [] });
  }

  const members = await prisma.membership.findMany({
    where: { workspaceId },
    select: { userId: true, user: { select: { email: true, isService: true } } },
  });

  const accounts = members.map(({ userId, user: u }) => {
    // Un compte de service n'a pas de boîte mail : lui chercher une identité
    // dans l'IdP n'a pas de sens, et proposer de lui en créer une en aurait
    // encore moins (elle serait humaine, avec activation en attente, pour un
    // compte qui voit les pages privées).
    if (u.isService) return { userId, status: "none" as IdpMemberStatus, service: true };

    const found = directory.accounts.get(u.email.trim().toLowerCase());
    let status: IdpMemberStatus;
    if (!found) status = directory.truncated ? "unknown" : "none";
    else if (!found.enabled) status = "suspended";
    else status = found.pending ? "pending" : "active";

    return { userId, status, service: false };
  });

  return NextResponse.json({
    configured: true,
    available: true,
    truncated: directory.truncated,
    accounts,
  });
}
