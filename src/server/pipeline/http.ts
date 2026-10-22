import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { identifierSchema, PipelineError } from "./contracts";

const MAX_BODY_BYTES = 1_000_000;

export async function body(request: Request) {
  // Enforce the limit while reading, including requests without Content-Length.
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new PipelineError(413, "Request body is too large.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try { return JSON.parse(text); } catch { throw new PipelineError(400, "Request body must be JSON."); }
}
export function customer(request: Request) {
  return identifierSchema.parse(new URL(request.url).searchParams.get("customer"));
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
