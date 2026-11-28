/**
 * External coding-agent integration (e.g. a Cursor Cloud Agent). Deliberately not connected in this build: running one
 * consumes paid credits and requires the CTO's explicit authorization, and no adapter is implemented. Approved
 * dispatches therefore fail with this reason and the package stays "generated" — never reported as executed.
 */
export type ExternalAgentStatus = { configured: false; reason: string } | { configured: true; executor: string };

export function externalAgentStatus(): ExternalAgentStatus {
  return {
    configured: false,
    reason:
      "No external coding agent is connected (running one spends paid credits and needs explicit authorization). The investigation package was generated but not executed.",
  };
}
