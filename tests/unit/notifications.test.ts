import { describe, it, expect } from "vitest";
import {
  parseNotificationPayload,
  serializeNotificationPayload,
  notificationPurgeCutoff,
  NOTIFICATION_PURGE_DAYS,
  isInvitationActionable,
  isKnownNotificationType,
  notificationMessage,
} from "@/lib/notifications";

/**
 * Logique pure de la cloche. Aucun DOM, aucune base : ce qui compte ici, c'est
 * qu'une notification ne fasse JAMAIS tomber le panneau, quoi qu'elle contienne.
 */

describe("Charge utile — tolérante à tout", () => {
  it("aller-retour", () => {
    const p = { workspaceName: "Laurence Lerel", actorName: "Ada" };
    expect(parseNotificationPayload(serializeNotificationPayload(p))).toEqual(p);
  });

  it("⚠️ un JSON illisible rend {} au lieu de lever", () => {
    // Une seule ligne corrompue ne doit pas casser toute la cloche.
    for (const mauvais of ["", "null", "pas du json", "[1,2]", "42", '"texte"']) {
      expect(parseNotificationPayload(mauvais)).toEqual({});
    }
    expect(parseNotificationPayload(null)).toEqual({});
    expect(parseNotificationPayload(undefined)).toEqual({});
  });
});

describe("Purge — une seule règle, par âge", () => {
  it("le seuil est à 90 jours", () => {
    expect(NOTIFICATION_PURGE_DAYS).toBe(90);
    const now = new Date("2026-08-07T12:00:00Z");
    const cutoff = notificationPurgeCutoff(now);
    expect((now.getTime() - cutoff.getTime()) / 86_400_000).toBe(90);
  });

  it("⚠️ dépasse les 30 j de la corbeille : on ne purge jamais une notification dont la cible est encore restaurable", () => {
    expect(NOTIFICATION_PURGE_DAYS).toBeGreaterThan(30);
  });
});

describe("Actionnable — le FILTRE est l'autorité, pas la purge", () => {
  const cutoff = new Date("2026-08-01T00:00:00Z");

  it("une invitation vivante porte le bouton", () => {
    expect(
      isInvitationActionable({ createdAt: new Date("2026-08-05"), declinedAt: null }, cutoff)
    ).toBe(true);
  });

  it("une invitation REFUSÉE ne le porte plus", () => {
    expect(
      isInvitationActionable(
        { createdAt: new Date("2026-08-05"), declinedAt: new Date("2026-08-06") },
        cutoff
      )
    ).toBe(false);
  });

  it("⚠️ une invitation PÉRIMÉE non plus — même si la ligne existe encore", () => {
    // WorkspaceInvitation ne purge ses expirées qu'au claim d'un email donné,
    // donc jamais si la personne ne se connecte pas. La notification ne peut
    // pas se fier à la disparition de la ligne.
    expect(
      isInvitationActionable({ createdAt: new Date("2026-07-20"), declinedAt: null }, cutoff)
    ).toBe(false);
  });

  it("une invitation supprimée non plus", () => {
    expect(isInvitationActionable(null, cutoff)).toBe(false);
    expect(isInvitationActionable(undefined, cutoff)).toBe(false);
  });
});

describe("Message — rendu à la lecture, jamais stocké", () => {
  it("le nom LU en base prime sur l'instantané du payload", () => {
    // L'instantané n'est qu'un repli : un espace renommé doit s'afficher sous
    // son nom actuel.
    const m = notificationMessage({
      type: "workspace_joined",
      payload: { workspaceName: "Ancien nom" },
      workspaceName: "Nom actuel",
    });
    expect(m).toContain("Nom actuel");
    expect(m).not.toContain("Ancien nom");
  });

  it("l'instantané sert de repli quand la cible a disparu", () => {
    const m = notificationMessage({
      type: "workspace_joined",
      payload: { workspaceName: "Espace supprimé" },
      workspaceName: null,
    });
    expect(m).toContain("Espace supprimé");
  });

  it("un acteur supprimé (FK SetNull) devient anonyme, sans casser la phrase", () => {
    const m = notificationMessage({
      type: "membership_removed",
      payload: {},
      workspaceName: "X",
      actorName: null,
    });
    expect(m).toContain("Quelqu'un");
    expect(m).toContain("X");
  });

  it("un changement de rôle dit d'où l'on vient et où l'on va, en français", () => {
    const m = notificationMessage({
      type: "role_changed",
      payload: { roleBefore: "admin", roleAfter: "viewer" },
      workspaceName: "X",
      actorName: "Ada",
    });
    expect(m).toContain("admin");
    expect(m).toContain("lecteur");
  });

  it("⚠️ un type INCONNU rend une ligne neutre au lieu de casser", () => {
    // Un retour arrière du code laisse en base des lignes déjà écrites : la
    // cloche doit survivre à un type qu'elle ne connaît plus.
    expect(isKnownNotificationType("workspace_invitation")).toBe(true);
    expect(isKnownNotificationType("chose_du_futur")).toBe(false);
    const m = notificationMessage({
      type: "chose_du_futur",
      payload: {},
      workspaceName: "X",
    });
    expect(m).toBeTruthy();
    expect(m).toContain("X");
  });
});
