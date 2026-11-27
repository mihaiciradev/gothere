import { AppError } from "@/shared/errors";

export type EventStatus = "draft" | "published" | "cancelled" | "completed";
export type ExperienceStatus = "draft" | "published" | "archived";

const eventTransitions: Record<EventStatus, readonly EventStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["cancelled", "completed"],
  cancelled: [],
  completed: [],
};

const experienceTransitions: Record<ExperienceStatus, readonly ExperienceStatus[]> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

export function assertEventTransition(from: EventStatus, to: EventStatus): void {
  if (from !== to && !eventTransitions[from].includes(to)) {
    throw new AppError("PRECONDITION_FAILED", `An event cannot move from ${from} to ${to}.`, { from, to });
  }
}

export function assertExperienceTransition(from: ExperienceStatus, to: ExperienceStatus): void {
  if (from !== to && !experienceTransitions[from].includes(to)) {
    throw new AppError("PRECONDITION_FAILED", `An experience cannot move from ${from} to ${to}.`, { from, to });
  }
}

/** Experiences can only be published into an event that is still upcoming or live. */
export function canHostPublishedExperience(eventStatus: EventStatus): boolean {
  return eventStatus === "draft" || eventStatus === "published";
}
