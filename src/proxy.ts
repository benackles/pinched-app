import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { authMode } from "@/lib/auth/config";
import { isProtectedPath } from "@/lib/auth/protected-routes";
import { LOCAL_SESSION_COOKIE, readLocalToken } from "@/server/local/session";

// Signed-out visitors go to our own branded pages, not Clerk's hosted Account Portal.
const withClerk = clerkMiddleware(
  async (auth, request) => {
    if (isProtectedPath(request.nextUrl.pathname)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

function redirectToSignIn(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  return NextResponse.redirect(url);
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const mode = authMode();

  if (mode === "clerk") return withClerk(request, event);

  if (isProtectedPath(request.nextUrl.pathname)) {
    if (mode === "local") {
      const session = readLocalToken(request.cookies.get(LOCAL_SESSION_COOKIE)?.value);
      if (!session) return redirectToSignIn(request);
    } else {
      // Not configured at all: the sign-in page explains what to set.
      return redirectToSignIn(request);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next internals and static files (incl. the service worker and manifest).
    "/((?!_next|sw\\.js|manifest\\.webmanifest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
