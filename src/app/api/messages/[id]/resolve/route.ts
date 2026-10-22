import { pipeline } from "../../../../../server/pipeline";
import { body, respond } from "../../../../../server/pipeline/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return respond(async () => pipeline.resolve((await context.params).id, await body(request)));
}
