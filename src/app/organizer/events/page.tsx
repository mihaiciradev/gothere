import { redirect } from "next/navigation";
import { Suspense } from "react";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Events are listed on the overview; this route keeps the spec's URL working. */
export default function OrganizerEventsIndex({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense>
      <Redirect searchParams={searchParams} />
    </Suspense>
  );
}

async function Redirect({ searchParams }: { searchParams: SearchParams }): Promise<null> {
  const org = (await searchParams).org;
  redirect(typeof org === "string" ? `/organizer?org=${encodeURIComponent(org)}` : "/organizer");
}
