import { getDb } from "@/infrastructure/db/client";
import { requirePlatformAdminById } from "@/modules/identity";
import { getInvestigationPackage } from "@/modules/incidents";
import { route } from "../../../_lib/http";
import { actorFrom } from "../../../_lib/session";

/** The package's sanitized report as Markdown, for reading or handing to an external agent by hand. */
export const GET = route<{ packageId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  const db = getDb();
  await requirePlatformAdminById(db, actor.userId);
  const pkg = await getInvestigationPackage(db, params.packageId);
  const markdown = String((pkg.report as { markdown?: string }).markdown ?? "");
  const header = `<!-- gothere investigation package ${pkg.id} · status: ${pkg.status}${pkg.status === "generated" ? " (not executed)" : ""} -->\n\n`;
  return new Response(header + markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="investigation-${pkg.id.slice(0, 8)}.md"`,
      "cache-control": "no-store",
    },
  });
});
