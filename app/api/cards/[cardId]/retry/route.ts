import { NextResponse } from "next/server";

import { retryCard } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export async function POST(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    retryCard(runtime(request).database, cardId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
