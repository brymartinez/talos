import { NextResponse } from "next/server";

import { boardSnapshot } from "@/src/services/board";
import { apiError, runtime } from "@/src/services/runtime";

export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  try {
    const { config, database } = runtime(request);
    return NextResponse.json(boardSnapshot(database, config));
  } catch (error) {
    return apiError(error);
  }
}
