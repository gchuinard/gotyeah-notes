import { describe, it, expect } from "vitest";
import { applyFilters, applySorts, deriveSeedFromFilters } from "@/lib/client/viewFilters";
import { groupValueOnDrop, initialGroupValue } from "@/lib/client/kanban";
import type { ParsedDatabaseProperty, ParsedRecord } from "@/lib/db";

const userProp = {
  id: "assignee",
  name: "Assigné",
  type: "user",
  config: { type: "user" },
} as unknown as ParsedDatabaseProperty;

const rec = (id: string, users?: string[]) =>
  ({
    id,
    title: id,
    properties: users === undefined ? {} : { assignee: users },
  } as unknown as ParsedRecord);

const ids = (rs: ParsedRecord[]) => rs.map((r) => r.id);

describe("applyFilters — propriété user (sémantique multiselect)", () => {
  const records = [rec("vide", []), rec("absent"), rec("un", ["u1"]), rec("deux", ["u1", "u2"])];

  it("isEmpty : tableau vide ET valeur absente", () => {
    expect(ids(applyFilters(records, [{ propertyId: "assignee", operator: "isEmpty" }], [userProp])))
      .toEqual(["vide", "absent"]);
  });

  it("isNotEmpty : au moins un assigné", () => {
    expect(ids(applyFilters(records, [{ propertyId: "assignee", operator: "isNotEmpty" }], [userProp])))
      .toEqual(["un", "deux"]);
  });

  it("contains <userId> : l'assigné est présent", () => {
    expect(
      ids(applyFilters(records, [{ propertyId: "assignee", operator: "contains", value: "u2" }], [userProp]))
    ).toEqual(["deux"]);
  });

  it("notContains <userId> : l'assigné est absent", () => {
    expect(
      ids(applyFilters(records, [{ propertyId: "assignee", operator: "notContains", value: "u1" }], [userProp]))
    ).toEqual(["vide", "absent"]);
  });

  it("eq/neq restent sans effet — l'UI doit les mapper sur contains/notContains", () => {
    const filtered = applyFilters(
      records,
      [{ propertyId: "assignee", operator: "eq", value: "u1" }],
      [userProp]
    );
    expect(ids(filtered)).toEqual(ids(records));
  });
});

describe("applySorts — propriété user", () => {
  it("trie par nombre d'assignés (comme un multiselect)", () => {
    const records = [rec("deux", ["u1", "u2"]), rec("absent"), rec("un", ["u1"])];
    expect(ids(applySorts(records, [{ propertyId: "assignee", direction: "asc" }], [userProp])))
      .toEqual(["absent", "un", "deux"]);
    expect(ids(applySorts(records, [{ propertyId: "assignee", direction: "desc" }], [userProp])))
      .toEqual(["deux", "un", "absent"]);
  });
});

describe("deriveSeedFromFilters — propriété user", () => {
  it("contains <userId> → la carte créée naît AVEC cet assigné (tableau)", () => {
    const seed = deriveSeedFromFilters(
      [{ propertyId: "assignee", operator: "contains", value: "u1" }],
      [userProp]
    );
    expect(seed).toEqual({ assignee: ["u1"] });
  });

  it("notContains / isEmpty : rien à semer (valeur négative ou absente)", () => {
    expect(
      deriveSeedFromFilters(
        [{ propertyId: "assignee", operator: "notContains", value: "u1" }],
        [userProp]
      )
    ).toEqual({});
    expect(
      deriveSeedFromFilters([{ propertyId: "assignee", operator: "isEmpty" }], [userProp])
    ).toEqual({});
  });
});

describe("kanban — une valeur user reste un tableau", () => {
  it("groupValueOnDrop conserve les autres assignés et n'écrit jamais une string", () => {
    expect(groupValueOnDrop("user", ["u1", "u2"], "u1", "u3")).toEqual(["u2", "u3"]);
    expect(groupValueOnDrop("user", ["u1"], "u1", null)).toBeNull();
  });

  it("initialGroupValue : tableau à un élément, pas une string", () => {
    expect(initialGroupValue("user", "u1")).toEqual(["u1"]);
  });
});
