import { NextResponse } from "next/server";
import { z } from "zod";

import { queueCardAction } from "@/src/services/cards";
import { apiError, runtime } from "@/src/services/runtime";

export async function DELETE(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    const input = z.object({ force: z.boolean().default(false) }).parse(await request.json().catch(() => ({})));
    queueCardAction(runtime(request).database, cardId, "delete_worktree", input);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
