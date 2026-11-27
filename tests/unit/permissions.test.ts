import { describe, expect, it } from "vitest";
import { organizationPermissions, roleGrants } from "@/modules/organizations";

describe("organization role permissions", () => {
  it("grants owners every permission", () => {
    for (const permission of organizationPermissions) expect(roleGrants("owner", permission)).toBe(true);
  });

  it("keeps analysts read-only", () => {
    expect(roleGrants("analyst", "analytics.read")).toBe(true);
    expect(roleGrants("analyst", "experience.publish")).toBe(false);
    expect(roleGrants("analyst", "action.approve")).toBe(false);
    expect(roleGrants("analyst", "inventory.write")).toBe(false);
  });

  it("does not let managers administer membership", () => {
    expect(roleGrants("manager", "experience.publish")).toBe(true);
    expect(roleGrants("manager", "organization.manage_members")).toBe(false);
  });
});
