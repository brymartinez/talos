import { NextResponse } from "next/server";

import { moveCard } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export async function POST(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    moveCard(runtime(request).database, cardId, await request.json());
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
