import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("session_token")?.value;
  if (!token) {
    // Pont de confiance MCP : ces appels ne portent pas de cookie mais les en-têtes
    // act-as. On laisse passer vers la route API, qui valide le secret en temps
    // constant et mappe l'email sur un User (cf. lib/session.ts > getServiceUser).
    const hasMcpBridge =
      !!request.headers.get("x-mcp-secret") &&
      !!request.headers.get("x-act-as-email");
    if (hasMcpBridge && pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
