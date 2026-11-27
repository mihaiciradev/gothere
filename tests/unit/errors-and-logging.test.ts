import { describe, expect, it } from "vitest";
import { redact } from "@/infrastructure/logging/logger";
import { AppError, toPublicError } from "@/shared/errors";

describe("public errors", () => {
  it("exposes structured codes for expected errors", () => {
    const error = new AppError("FORBIDDEN", "Not allowed.");
    expect(error.httpStatus).toBe(403);
    expect(toPublicError(error)).toEqual({ code: "FORBIDDEN", message: "Not allowed." });
  });

  it("never leaks internal error messages", () => {
    expect(toPublicError(new Error("connection string postgres://secret"))).toEqual({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
  });
});

describe("log redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    expect(
      redact({ user: { email: "a@b.test", password: "x" }, headers: { authorization: "Bearer y", cookie: "z" }, apiKey: "k" }),
    ).toEqual({
      user: { email: "a@b.test", password: "[redacted]" },
      headers: { authorization: "[redacted]", cookie: "[redacted]" },
      apiKey: "[redacted]",
    });
  });
});
