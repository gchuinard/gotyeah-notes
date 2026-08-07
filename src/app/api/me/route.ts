import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * Profil de l'utilisateur COURANT. Aucun paramètre d'identité : on ne modifie
 * que soi-même, l'id vient de la session. C'est ce qui dispense cette route de
 * gate de rôle — un lecteur doit pouvoir corriger son propre nom, au même titre
 * qu'il peut enregistrer une visite ou changer d'espace actif.
 *
 * ⚠️ L'EMAIL N'EST PAS MODIFIABLE ICI, et ce n'est pas un oubli. C'est la clé de
 * liaison avec l'IdP : le callback OIDC retrouve le compte par `email`, et le
 * claim d'invitation repose dessus. Le laisser changer depuis notes ferait qu'à
 * la connexion suivante la personne serait soit refusée (OIDC_ALLOW_SIGNUP=false,
 * aucune invitation vivante), soit provisionnée comme un NOUVEAU compte —
 * perdant ses memberships, ses pages privées et son historique. Un changement
 * d'adresse doit partir de l'IdP, pas d'ici.
 *
 * ⚠️ Un compte de SERVICE n'a pas d'écran de profil : il ne se connecte jamais
 * par l'interface. La route le refuse malgré tout, plutôt que de dépendre de
 * l'absence d'UI — le pont MCP passe par `getSession()` comme tout le monde.
 */

const patchProfileSchema = z
  .object({
    // Le nom affiché PARTOUT (header, sidebar, acteur des révisions, assignés).
    // Vide, il ferait disparaître la personne des cartes où elle est assignée.
    displayName: z.string().trim().min(1).max(60).optional(),
    // Servent au provisioning IdP (prénom/nom séparés côté Keycloak), et à rien
    // d'autre côté notes : ils peuvent légitimement être vides.
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à modifier" });

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (user.isService) {
    return NextResponse.json(
      { error: "Un compte de service n'a pas de profil modifiable." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = patchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: parsed.data,
    select: { firstName: true, lastName: true, displayName: true, email: true },
  });

  return NextResponse.json(updated);
}
