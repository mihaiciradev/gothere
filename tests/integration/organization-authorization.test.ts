import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/identity";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";
import { addMember, createOrganization, createUser, openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());

const actorFor = (user: { id: string; email: string }, platformRole: Actor["platformRole"] = "attendee"): Actor => ({
  kind: "user",
  userId: user.id,
  email: user.email,
  platformRole,
});

async function expectAppError(promise: Promise<unknown>, code: AppError["code"]) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe("organization authorization", () => {
  it("grants permissions from the stored membership role", async () => {
    const org = await createOrganization(db);
    const owner = await createUser(db);
    await addMember(db, org.id, owner.id, "owner");

    const context = await requireOrganizationPermission(db, actorFor(owner), org.id, "experience.publish");
    expect(context).toMatchObject({ organizationId: org.id, role: "owner" });
  });

  it("rejects a member whose role lacks the permission", async () => {
    const org = await createOrganization(db);
    const analyst = await createUser(db);
    await addMember(db, org.id, analyst.id, "analyst");

    await expectAppError(requireOrganizationPermission(db, actorFor(analyst), org.id, "experience.publish"), "FORBIDDEN");
  });

  it("rejects cross-tenant access without disclosing the tenant", async () => {
    const orgA = await createOrganization(db);
    const orgB = await createOrganization(db);
    const ownerA = await createUser(db);
    await addMember(db, orgA.id, ownerA.id, "owner");

    await expectAppError(requireOrganizationPermission(db, actorFor(ownerA), orgB.id, "event.read"), "NOT_FOUND");
  });

  it("does not grant tenant permissions to platform administrators by role alone", async () => {
    const org = await createOrganization(db);
    const admin = await createUser(db, { platformRole: "platform_admin" });

    await expectAppError(
      requireOrganizationPermission(db, actorFor(admin, "platform_admin"), org.id, "event.read"),
      "NOT_FOUND",
    );
  });
});
