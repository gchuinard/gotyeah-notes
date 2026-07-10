import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import {
  serializeDatabaseProperty,
  parseDatabaseProperty,
  type PropertyType,
  type PropertyConfig,
} from "@/lib/db";
import { validatePropertyConfig } from "@/lib/propertyConfig";

const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "url",
  "email",
] as const;

const createPropertySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(PROPERTY_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
});

function defaultConfig(type: PropertyType): PropertyConfig {
  switch (type) {
    case "select":
    case "multiselect":
      return { type, options: [] };
    case "number":
      return { type, format: "decimal" };
    case "date":
      return { type, includeTime: false };
    default:
      return { type } as PropertyConfig;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: databaseId } = await params;
  const access = await checkDatabaseAccess(databaseId, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (body && typeof body === "object" && (body as Record<string, unknown>).type === "title") {
    return NextResponse.json(
      { error: "Cannot create a title property — there is already one per database" },
      { status: 400 }
    );
  }

  const result = createPropertySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { name, type, config: rawConfig } = result.data;

  const config: PropertyConfig =
    rawConfig !== undefined ? (rawConfig as PropertyConfig) : defaultConfig(type);

  if (config.type !== type) {
    return NextResponse.json(
      { error: "config.type must match type" },
      { status: 400 }
    );
  }

  // select/multiselect : options validées strictement (id/name non vides, couleur
  // dans la palette) — les ids fournis sont préservés tels quels.
  const validation = validatePropertyConfig(config);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.details },
      { status: 400 }
    );
  }

  const position = await nextPosition("databaseProperty", { databaseId });

  const property = await prisma.databaseProperty.create({
    data: {
      databaseId,
      name,
      type,
      position,
      ...serializeDatabaseProperty({ config }),
    },
  });

  return NextResponse.json(parseDatabaseProperty(property), { status: 201 });
}
