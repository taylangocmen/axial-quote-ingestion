import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const items = await db.catalogItem.findMany({ orderBy: { sku: "asc" } });
  return Response.json({ items });
}
