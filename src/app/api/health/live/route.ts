export const dynamic = "force-dynamic";

/** Liveness: the process answers. No dependencies are touched (used by the host to decide on restarts). */
export async function GET() {
  return Response.json({ ok: true, status: "live", at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
