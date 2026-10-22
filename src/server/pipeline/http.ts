import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { PipelineError } from "./contracts";
export async function body(request: Request) {
  const text = await request.text();
  if (text.length > 1_000_000) throw new PipelineError(413, "Request body is too large.");
  try { return JSON.parse(text); } catch { throw new PipelineError(400, "Request body must be JSON."); }
}
export function customer(request: Request) {
  return z.string().trim().min(1).max(200).parse(new URL(request.url).searchParams.get("customer"));
}
export async function respond(operation: () => Promise<unknown>) {
  try { return Response.json(await operation()); }
  catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid input", issues: error.issues }, { status: 422 });
    if (error instanceof PipelineError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "Conflicting identity or duplicate record." }, { status: 409 });
    // Do not expose database credentials, request text, or model output in error responses.
    return Response.json({ error: "Operation failed; no partial quote changes were committed. Retry or check local database setup." }, { status: 503 });
  }
}
