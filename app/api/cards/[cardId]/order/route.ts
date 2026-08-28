import { NextResponse } from "next/server";

import { reorderCard } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export async function POST(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    reorderCard(runtime().database, cardId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
