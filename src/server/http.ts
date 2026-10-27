import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "@/server/errors";

export function ok<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? null } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid request", details: error.issues } }, { status: 400 });
  }
  console.error("[api] unhandled", error);
  return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

/** Wrap a route handler: errors become structured JSON responses. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return fail(e);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown = {};
  const text = await req.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError(400, "BAD_JSON", "Request body is not valid JSON");
    }
  }
  return schema.parse(json);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (obj[k] = v));
  return schema.parse(obj);
}

export function clientIp(req: Request): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}
