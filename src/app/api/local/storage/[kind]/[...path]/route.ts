import { isLocalMode } from "@/lib/auth/config";
import { handleLocalObject, handleLocalUpload } from "@/server/media/local-store";

/**
 * Local mode's stand-in for Supabase Storage (signed upload and read URLs over files on disk).
 * Refused everywhere else, and every request needs a valid signed token.
 */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ kind: string; path: string[] }> };

const gone = () => new Response("Not found", { status: 404 });

export async function PUT(request: Request, { params }: Context) {
  if (!isLocalMode()) return gone();
  const { kind, path } = await params;
  return kind === "upload" ? handleLocalUpload(request, path.join("/")) : gone();
}

async function read(request: Request, { params }: Context) {
  if (!isLocalMode()) return gone();
  const { kind, path } = await params;
  return kind === "object" ? handleLocalObject(request, path.join("/")) : gone();
}

export const GET = read;
export const HEAD = read;
