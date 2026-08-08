import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole, isPageAccessible } from "@/lib/workspace";
import {
  addedAssignees,
  shouldCoalesceAssignment,
  parseNotificationPayload,
  serializeNotificationPayload,
} from "@/lib/notifications";
import { validateRelationValues } from "@/lib/relations";
import { validateUserValues } from "@/lib/assignees";
import { deniedTransitions, type TransitionRule } from "@/lib/permissionRules";
import {
  serializeRecord,
  parseRecord,
  parseSectionsBody,
  parseManyDatabaseProperties,
  mergeRecordProperties,
  serializeSectionsBody,
  diffRecordRevisions,
  shouldCoalesceRevision,
  type RecordProperties,
  type RecordSection,
} from "@/lib/db";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(parseRecord(access.record));
}

const patchRecordSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  content: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  position: z.number().optional(),
  // Corps sectionné (templates) : remplacement TOTAL des sections fournies.
  // null = repasser en corps libre. templateId = template appliqué à ce record.
  sectionsBody: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        content: z.array(z.unknown()),
      })
    )
    .nullable()
    .optional(),
  templateId: z.string().nullable().optional(),
  // Affectation à un sprint (vue backlog). null = renvoyer au backlog.
  sprintId: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const result = patchRecordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Gate AVANT le diff des révisions et la transaction : un refus n'écrit rien.
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const {
    title,
    icon,
    content,
    properties: rawProperties,
    position,
    sectionsBody,
    templateId,
    sprintId,
  } = result.data;

  let mergedProperties: RecordProperties | undefined;
  if (rawProperties !== undefined) {
    // Garde-fou : les ids d'une propriété relation doivent appartenir à sa database
    // cible. On valide le PATCH entrant (une valeur null = suppression, tolérée).
    const relationCheck = await validateRelationValues(
      access.databaseId,
      rawProperties as RecordProperties
    );
    if (!relationCheck.ok) {
      return NextResponse.json({ error: relationCheck.error }, { status: 400 });
    }
    // Sur le patch BRUT, jamais sur le merge : un assigné devenu ex-membre ne
    // doit pas bloquer les écritures suivantes sur les autres champs.
    const assigneeCheck = await validateUserValues(
      access.workspaceId,
      access.databaseId,
      rawProperties as RecordProperties
    );
    if (!assigneeCheck.ok) {
      return NextResponse.json({ error: assigneeCheck.error }, { status: 400 });
    }
    const existing = parseRecord(access.record).properties;
    mergedProperties = mergeRecordProperties(existing, rawProperties as RecordProperties);
  }

  // Garde-fou : un sprint affecté doit appartenir à la même database (sinon FK 500
  // ou affectation incohérente entre bases).
  if (sprintId) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, databaseId: access.databaseId },
      select: { id: true },
    });
    if (!sprint) {
      return NextResponse.json({ error: "Sprint introuvable" }, { status: 400 });
    }
  }

  // Piste d'audit : une révision par CHAMP réellement changé (title/content/
  // property/section). Diff calculé AVANT l'update, à partir de l'état existant.
  const changes = diffRecordRevisions(
    {
      title: access.record.title,
      content: access.record.content,
      properties: parseRecord(access.record).properties,
      sectionsBody: parseSectionsBody(access.record.sectionsBody),
    },
    {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(rawProperties !== undefined && { properties: rawProperties as RecordProperties }),
      ...(sectionsBody !== undefined && { sectionsBody: sectionsBody as RecordSection[] | null }),
    }
  );
  // ─── Permissions fines par colonne ───────────────────────────────────────────
  // Placé APRÈS le diff (on ne compte que les transitions RÉELLES : une valeur
  // réémise à l'identique n'est pas dans `changes`) et AVANT toute écriture — un
  // refus ne doit laisser ni record modifié ni RecordRevision.
  const changedPropIds = Object.keys(rawProperties ?? {}).filter((k) =>
    changes.some((c) => c.field === k)
  );
  if (changedPropIds.length > 0) {
    // Scopé databaseId : la route accepte n'importe quelle clé de propriété sans
    // la valider contre le schéma, ce filtre est donc aussi un garde-fou.
    const props = await prisma.databaseProperty.findMany({
      where: { id: { in: changedPropIds }, databaseId: access.databaseId },
    });
    const actor = { userId: user.id, role: access.membership.role };
    const before = parseRecord(access.record).properties;
    const denied: { propertyId: string; optionIds: string[] }[] = [];

    for (const prop of parseManyDatabaseProperties(props)) {
      const rules = (prop.config as { rules?: TransitionRule[] }).rules;
      if (!rules?.length) continue;
      const optionIds = deniedTransitions(
        rules,
        before[prop.id],
        (rawProperties as RecordProperties)[prop.id],
        actor
      );
      if (optionIds.length > 0) denied.push({ propertyId: prop.id, optionIds });
    }

    if (denied.length > 0) {
      return NextResponse.json(
        { error: "Transition non autorisée", details: { denied } },
        { status: 403 }
      );
    }
  }

  const now = new Date();

  // Quelles propriétés modifiées sont de type `user` ? Lu avant la transaction :
  // c'est une lecture de schéma, elle n'a pas à tenir la base ouverte.
  //
  const assigneeProps =
    rawProperties === undefined || changedPropIds.length === 0
      ? []
      : await prisma.databaseProperty.findMany({
          where: { id: { in: changedPropIds }, databaseId: access.databaseId, type: "user" },
          select: { id: true },
        });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.record.update({
      where: { id },
      data: {
        ...serializeRecord({
          ...(title !== undefined && { title }),
          ...(icon !== undefined && { icon }),
          ...(content !== undefined && { content }),
          ...(position !== undefined && { position }),
          ...(mergedProperties !== undefined && { properties: mergedProperties }),
        }),
        ...(sectionsBody !== undefined && {
          sectionsBody:
            sectionsBody === null ? null : serializeSectionsBody(sectionsBody as RecordSection[]),
        }),
        ...(templateId !== undefined && { templateId }),
        ...(sprintId !== undefined && { sprintId }),
      },
    });

    for (const change of changes) {
      // Coalescence : fusion dans la dernière révision du champ si même acteur < 2 min,
      // sinon nouvelle ligne. On conserve le `before` d'origine, on rafraîchit after+date.
      const last = await tx.recordRevision.findFirst({
        where: { recordId: id, field: change.field },
        orderBy: { createdAt: "desc" },
        select: { id: true, actorId: true, createdAt: true },
      });
      if (shouldCoalesceRevision(last, user.id, now)) {
        await tx.recordRevision.update({
          where: { id: last!.id },
          data: { after: JSON.stringify(change.after ?? null), createdAt: now },
        });
      } else {
        await tx.recordRevision.create({
          data: {
            recordId: id,
            actorId: user.id,
            field: change.field,
            before: JSON.stringify(change.before ?? null),
            after: JSON.stringify(change.after ?? null),
            createdAt: now,
          },
        });
      }
    }

    // ─── Notifier les assignés AJOUTÉS ────────────────────────────────────────
    // Dans la MÊME transaction que l'écriture : hors d'elle, une notification
    // survivrait à un rollback et annoncerait une assignation qui n'a pas eu lieu.
    if (assigneeProps.length > 0) {
      const nouveaux = new Map<string, string>(); // userId → propertyId
      for (const prop of assigneeProps) {
        const change = changes.find((c) => c.field === prop.id);
        if (!change) continue;
        for (const uid of addedAssignees(change.before, change.after)) {
          // ⚠️ On ne se notifie JAMAIS soi-même : s'assigner une carte est un
          // geste dont on est déjà au courant. Ce filtre vit ici parce que
          // l'écriture ne passe pas par `notify()` — la coalescence exige de
          // lire la dernière ligne, ce que ce helper ne fait pas.
          //
          // ⚠️ ET LA PAGE DOIT ÊTRE ACCESSIBLE AU DESTINATAIRE, pas à l'acteur.
          // Le message porte le TITRE de la carte : prévenir quelqu'un d'une
          // assignation sur une page privée qu'il ne peut pas ouvrir lui
          // divulguerait ce titre et le laisserait devant un 404. Le test doit
          // donc porter sur `uid`, jamais sur `user.id` — une garde écrite avec
          // l'acteur ne se déclenche que quand l'acteur est lui-même exclu,
          // c'est-à-dire jamais (il vient d'écrire sur cette carte).
          //
          // Le 3e argument vaut `false` À DESSEIN : on évalue le destinataire
          // comme un HUMAIN. L'exemption de compte de service sert à laisser
          // l'automatisation LIRE, pas à lui faire recevoir des messages — et
          // les comptes de service sont écartés juste en dessous.
          if (
            uid !== user.id &&
            !nouveaux.has(uid) &&
            isPageAccessible(access.page, uid, false)
          ) {
            nouveaux.set(uid, prop.id);
          }
        }
      }

      // ⚠️ Un compte de SERVICE n'est JAMAIS destinataire. C'est la règle de
      // `notify()`, redéclarée ici pour la même raison que « jamais soi-même » :
      // cette écriture ne passe pas par le helper, la coalescence exigeant de
      // lire la dernière ligne. Elle manquait — un compte de service assigné
      // accumulait des lignes de cloche qu'il ne peut pas lire. Une seule
      // requête, quel que soit le nombre de destinataires.
      const humains =
        nouveaux.size === 0
          ? []
          : await tx.user.findMany({
              where: { id: { in: [...nouveaux.keys()] }, isService: false },
              select: { id: true },
            });

      for (const { id: uid } of humains) {
        // ⚠️ Coalescence : `BulkActionBar` envoie un PATCH par carte. Sans
        // fusion, cocher 30 cartes ferait 30 lignes dans la cloche pour un seul
        // geste. Même fenêtre et même raison que les révisions.
        const last = await tx.notification.findFirst({
          where: { userId: uid, type: "record_assigned", workspaceId: access.workspaceId },
          orderBy: { createdAt: "desc" },
          select: { id: true, actorId: true, createdAt: true, payload: true },
        });

        if (shouldCoalesceAssignment(last, user.id, now)) {
          const p = parseNotificationPayload(last!.payload);
          await tx.notification.update({
            where: { id: last!.id },
            data: {
              // Au-delà de la première, le titre d'UNE carte ne veut plus rien
              // dire : on compte, et le message bascule au pluriel.
              payload: serializeNotificationPayload({
                ...p,
                count: (p.count ?? 1) + 1,
                recordTitle: undefined,
                recordId: undefined,
              }),
              readAt: null,
              createdAt: now,
            },
          });
        } else {
          await tx.notification.create({
            data: {
              userId: uid,
              type: "record_assigned",
              workspaceId: access.workspaceId,
              actorId: user.id,
              // Pas de workspaceName ici : il est résolu à la LECTURE via la
              // relation, et un espace renommé doit s'afficher sous son nom
              // actuel. On ne copie que ce qui n'existe nulle part ailleurs.
              payload: serializeNotificationPayload({
                actorName: user.displayName,
                recordTitle: (title ?? access.record.title) || undefined,
                recordId: id,
                pageId: access.page.id,
              }),
              createdAt: now,
            },
          });
        }
      }
    }

    return row;
  });

  return NextResponse.json(parseRecord(updated));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // ?permanent=1 : suppression DÉFINITIVE (depuis la corbeille) — accède aux records trashés.
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";

  const access = await checkRecordAccess(id, user.id, permanent);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Double gate : corbeille (réversible) = editor, ?permanent=1 (définitif) = admin.
  if (!hasRole(access.membership, permanent ? "admin" : "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  if (permanent) {
    await prisma.record.delete({ where: { id } });
  } else {
    // Soft delete : mise en corbeille (restaurable, purge auto après 30 j).
    await prisma.record.update({ where: { id }, data: { trashedAt: new Date() } });
  }

  return NextResponse.json({ ok: true });
}
