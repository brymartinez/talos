import { NextResponse } from "next/server";
import { prepareContinuation } from "@/src/services/continuation";
import { apiError, runtime } from "@/src/services/runtime";

export async function POST(request: Request, context: { params: Promise<{ cardId: string }> }): Promise<NextResponse> {
  try {
    const { cardId } = await context.params;
    const { database, config } = runtime(request);
    return NextResponse.json(prepareContinuation(database, config, cardId));
  } catch (error) {
    return apiError(error);
  }
}
