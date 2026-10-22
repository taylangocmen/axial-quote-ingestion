import { pipeline } from "../../../server/pipeline";
import { customer, respond } from "../../../server/pipeline/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return respond(() => pipeline.unresolved(customer(request)));
}
