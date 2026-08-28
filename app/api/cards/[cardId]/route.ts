import { NextResponse } from "next/server";

import { updateCard } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export async function PATCH(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    updateCard(runtime().database, cardId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
