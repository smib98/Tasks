import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details
    },
    {
      status
    }
  );
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("Validation failed.", 422, error.flatten());
  }

  if (error instanceof Error && error.message === "Invalid JSON body.") {
    return jsonError(error.message, 400);
  }

  console.error(error);
  return jsonError("Something went wrong.", 500);
}
