import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getConfigResult, type AppConfig } from "@/src/config/env";
import { getDatabase } from "@/src/db/client";

export class ServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export function runtime(): Readonly<{ config: AppConfig; database: ReturnType<typeof getDatabase> }> {
  const result = getConfigResult();
  if (!result.ok) throw new ServiceError("configuration_error", "The app configuration is incomplete.", 503);
  return { config: result.config, database: getDatabase(result.config) };
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "The request data is invalid.", fields: error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  const known = error instanceof ServiceError ? error : null;
  if (!known) console.error(error);
  return NextResponse.json(
    { error: { code: known?.code ?? "internal_error", message: known?.message ?? "The request could not be completed." } },
    { status: known?.status ?? 500 },
  );
}
