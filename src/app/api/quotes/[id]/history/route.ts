import { pipeline } from "../../../../../server/pipeline";
import { customer, respond } from "../../../../../server/pipeline/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return respond(async () => pipeline.history((await context.params).id, customer(request)));
}
