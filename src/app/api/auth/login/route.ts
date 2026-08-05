import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { legacyLoginEnabled, normalizeEmail } from "@/lib/oidc";
import { tooManyFailures, recordFailure, clearFailures, retryAfterSeconds } from "@/lib/rateLimit";
import { claimInvitationsSafely } from "@/lib/invitations";

// Hash bcrypt factice (coût 12, comme les vrais) : comparé quand l'email est inconnu
// pour que le temps de réponse soit identique à « mauvais mot de passe » → pas d'oracle
// d'énumération par timing. Calculé une fois, à la première demande.
let dummyHash: string | null = null;
function equalizerHash(): string {
  if (!dummyHash) dummyHash = bcrypt.hashSync("timing-equalizer-not-a-real-password", 12);
  return dummyHash;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : req.headers.get("x-real-ip") || "unknown").trim();
}

const INVALID = "Email ou mot de passe incorrect";

export async function POST(req: Request) {
  if (!legacyLoginEnabled()) {
    return NextResponse.json(
      { error: "Connexion par mot de passe désactivée. Utilisez « Se connecter avec GotYeah »." },
      { status: 403 },
    );
  }
  const { email, password } = await req.json().catch(() => ({}));

  if (!email || !password) {
    return NextResponse.json({ error: "Email et mot de passe requis" }, { status: 400 });
  }

  const normalized = normalizeEmail(email);
  const key = `${clientIp(req)}|${normalized}`;

  // Trop d'échecs récents : rejet AVANT bcrypt (anti brute-force / énumération).
  if (tooManyFailures(key)) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessaie plus tard." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(key)) } },
    );
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  // bcrypt.compare TOUJOURS exécuté (hash factice si email inconnu) → temps constant.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? equalizerHash());

  if (!user || !valid) {
    recordFailure(key);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  clearFailures(key);
  // Rattrapage de la course « invitation posée alors que la personne était DÉJÀ
  // inscrite » : POST /members a bien créé la membership dans ce cas, mais si
  // l'invitation a été posée avant que le compte existe et que la personne se
  // connecte par mot de passe plutôt que par l'IdP, c'est ici qu'elle est
  // réclamée. Le compte existe déjà : aucune question de vérification d'email.
  await claimInvitationsSafely(user.id, user.email);
  const token = await createSession(user.id);

  const res = NextResponse.json({ id: user.id, email: user.email });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
