import { NextResponse } from "next/server";

import { queueSync } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export function POST(): NextResponse {
  try {
    const { database } = runtime();
    return NextResponse.json({ jobId: queueSync(database) }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
