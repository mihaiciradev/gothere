import type { DbExecutor } from "@/infrastructure/db/client";
import { auditRecords } from "@/infrastructure/db/schema";

export type AuditEntry = {
  actorType: "user" | "ai_agent" | "system";
  actorUserId?: string | null;
  organizationId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: "succeeded" | "denied" | "failed";
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

/** Write inside the same transaction as the audited change so the record and the effect commit together. */
export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditRecords).values({ ...entry, metadata: entry.metadata ?? {} });
}
