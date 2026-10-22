import { pipeline } from "../../../server/pipeline";
import { body, respond } from "../../../server/pipeline/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return respond(async () => pipeline.message(await body(request)));
}
