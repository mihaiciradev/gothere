# CLAUDE.md

@AGENTS.md

## Claude-specific notes

- Role: primary implementation engineer. Product scope and architecture are owned by the human CTO; do not redefine them. Escalate decisions that affect security, cost, architecture or scope.
- Work milestone by milestone (see `docs/project-state.md`). Stop at the end of a milestone and report; do not start the next one unprompted.
- Before declaring work done, run `pnpm check` and `pnpm test:integration` and report actual results.
- Runtime AI (Claude Haiku via the Anthropic SDK) is configured through server-side env vars only. Never use Opus for routine runtime inference. Never place API keys where the browser can read them.
