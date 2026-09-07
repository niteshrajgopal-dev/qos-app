import { databaseHealthResponse } from "@/lib/database-health";

export const dynamic = "force-dynamic";

export async function GET() {
  return databaseHealthResponse();
}
