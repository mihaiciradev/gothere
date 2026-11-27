# ADR-0003: Better Auth for authentication; tenancy and permissions owned by the domain

Status: Accepted · 2026-11-27

## Context
Need secure sessions quickly (hashing, cookies, CSRF, rate limits) but authorization rules (organizations, roles, AI action permissions, approvals) are core product logic that must be testable and explicit.

## Decision
- Better Auth (email + password) with the Drizzle adapter on our own tables (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`), UUID ids, DB-backed rate limiting (serverless-safe), `nextCookies` plugin.
- `users.platform_role` (`attendee` | `platform_admin`) as a Better Auth additional field with `input: false`.
- Organizations and memberships are our own tables and module, not the Better Auth organization plugin. Role → permission policy is pure domain code; `requireOrganizationPermission` is the single gate.
- Platform admins receive no implicit tenant permissions.

## Consequences
+ Authorization is one function, unit- and integration-tested, reusable by the action registry.
+ No vendor-specific tenancy semantics to work around later.
− We own membership management UI and invitations (deferred; seeded for the MVP).
