export const runtime = "nodejs";

export function GET() {
  // Liveness only: this does not claim that the database is ready.
  return Response.json({ status: "ok", service: "axial-quote-ingestion" });
}
