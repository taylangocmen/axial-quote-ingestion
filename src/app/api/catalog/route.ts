import { db } from "@/server/db";
import { respond } from "@/server/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return respond(async () => ({
    items: await db.catalogItem.findMany({ orderBy: { sku: "asc" } }),
  }));
}
