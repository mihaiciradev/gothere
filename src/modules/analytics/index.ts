export {
  type Assumptions,
  type ConversionScenario,
  type Evidence,
  type Opportunity,
  type Proposal,
  OPPORTUNITY_RULES,
  groundedNumbers,
  rulesNarrative,
  ungroundedNumbers,
} from "./domain/opportunity";
export { shiftLocalDays } from "./domain/local-time";
export {
  type Recommendation,
  type RecommendationOutcome,
  analyzeDemand,
  applyNarrative,
  dismissRecommendation,
  getRecommendation,
  listRecommendations,
  markRecommendationDrafted,
  markRecommendationPublished,
  recommendationOutcomes,
} from "./recommendations";
export {
  type EventInsights,
  type EventSalesRow,
  type OrganizationSales,
  getEventInsights,
  getOrganizationSales,
  topUnmatchedSearches,
} from "./sales";
export {
  type DemandSubject,
  type SignalDeps,
  isOnWaitlist,
  joinWaitlist,
  normalizeQuery,
  recordSoldOutViews,
  recordUnmatchedSearch,
  soldOutViewSchema,
  subjectKey,
} from "./signals";
