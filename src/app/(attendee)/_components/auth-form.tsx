"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "@/components/auth/auth-client";

type Mode = "sign-in" | "sign-up";
type FieldErrors = Partial<Record<"name" | "email" | "password", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function messageFor(code: string | undefined, status: number | undefined, mode: Mode): string {
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don’t match an account.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 12 characters.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    default:
      return mode === "sign-in" ? "We couldn’t sign you in. Please try again." : "We couldn’t create your account. Please try again.";
  }
}

/**
 * Email and password form on Better Auth. `next` has already been validated server-side
 * (safeRedirectPath); the session cookie is HttpOnly and set by the server.
 */
export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});

  // Reset when Next hides this route in an <Activity> boundary after navigating away.
  useEffect(() => () => setPending(false), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const errors: FieldErrors = {};
    if (mode === "sign-up" && name.length < 2) errors.name = "Tell us your name.";
    if (!EMAIL.test(email)) errors.email = "Enter a valid email address.";
    if (mode === "sign-up" && password.length < 12) errors.password = "Use at least 12 characters.";
    if (mode === "sign-in" && password.length === 0) errors.password = "Enter your password.";
    setFields(errors);
    setError(null);
    if (Object.keys(errors).length) return;

    setPending(true);
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });
    if (result.error) {
      setPending(false);
      setError(messageFor(result.error.code, result.error.status, mode));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const input =
    "mt-2 w-full border-b border-graphite-600 bg-transparent py-3 text-lg text-offwhite placeholder:text-graphite-400 focus:border-lime focus:outline-none aria-[invalid=true]:border-danger";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      {mode === "sign-up" && (
        <div>
          <label htmlFor="name" className="label text-graphite-400">Name</label>
          <input id="name" name="name" autoComplete="name" className={input} aria-invalid={!!fields.name} aria-describedby={fields.name ? "name-error" : undefined} />
          {fields.name && <p id="name-error" className="mt-2 text-sm text-danger">{fields.name}</p>}
        </div>
      )}
      <div>
        <label htmlFor="email" className="label text-graphite-400">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          className={input}
          aria-invalid={!!fields.email}
          aria-describedby={fields.email ? "email-error" : undefined}
        />
        {fields.email && <p id="email-error" className="mt-2 text-sm text-danger">{fields.email}</p>}
      </div>
      <div>
        <label htmlFor="password" className="label text-graphite-400">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          className={input}
          aria-invalid={!!fields.password}
          aria-describedby={fields.password ? "password-error" : mode === "sign-up" ? "password-hint" : undefined}
        />
        {fields.password ? (
          <p id="password-error" className="mt-2 text-sm text-danger">{fields.password}</p>
        ) : (
          mode === "sign-up" && <p id="password-hint" className="mt-2 text-sm text-graphite-400">At least 12 characters.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-offwhite">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-between bg-lime px-5 py-4 font-medium text-obsidian transition-colors hover:bg-offwhite disabled:bg-graphite-700 disabled:text-graphite-400"
      >
        <span>{pending ? (mode === "sign-in" ? "Signing in…" : "Creating your account…") : mode === "sign-in" ? "Sign in" : "Create account"}</span>
        <span aria-hidden>→</span>
      </button>

      <p className="text-sm text-graphite-300">
        {mode === "sign-in" ? "New to gothere? " : "Already have an account? "}
        <Link
          href={`/${mode === "sign-in" ? "sign-up" : "sign-in"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-offwhite underline underline-offset-4 hover:text-lime"
        >
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
