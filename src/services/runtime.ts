import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getConfigResult, type AppConfig } from "@/src/config/env";
import { getDatabase } from "@/src/db/client";

export class ServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

function assertLocalRequest(request: Request): void {
  const url = new URL(request.url);
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];
  const hostHeader = request.headers.get("host");
  let headerHostname = "";
  try {
    headerHostname = hostHeader ? new URL(`http://${hostHeader}`).hostname : "";
  } catch {
    headerHostname = "";
  }
  if (!localHosts.includes(url.hostname) || !localHosts.includes(headerHostname)) {
    throw new ServiceError("local_access_only", "This app only accepts local requests.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    throw new ServiceError("invalid_origin", "Cross-site requests are not allowed.", 403);
  }
}

export function runtime(request: Request): Readonly<{ config: AppConfig; database: ReturnType<typeof getDatabase> }> {
  assertLocalRequest(request);
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
