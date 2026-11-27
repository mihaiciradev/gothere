/** Architectural boundaries. Source of truth: docs/architecture.md#dependency-rules */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      comment: "Domain code holds business rules only: no I/O, frameworks or infrastructure.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: {
        path: ["^src/(app|components|infrastructure|ai|actions)/", "^src/modules/[^/]+/(?!domain/)"],
      },
    },
    {
      name: "domain-no-frameworks",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "node_modules/(next|react|react-dom|drizzle-orm|pg|better-auth|@anthropic-ai)/" },
    },
    {
      name: "modules-public-api-only",
      comment: "A module may import another module only through its index.ts.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/([^/]+)/.+", pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"] },
    },
    {
      name: "modules-not-presentation",
      comment: "Business logic never depends on delivery (Next.js routes), UI or the composition root.",
      severity: "error",
      from: { path: "^src/(modules|ai|actions|infrastructure|shared)/" },
      to: { path: "^src/(app|components|composition)/" },
    },
    {
      name: "infrastructure-not-modules",
      comment: "Infrastructure provides adapters; it must not depend on business modules.",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "^src/(modules|ai|actions)/" },
    },
    {
      name: "shared-is-leaf",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/(?!shared/)" },
    },
    {
      name: "components-no-server-internals",
      comment: "UI components are presentational: no database, auth internals, secrets, business modules or app routes.",
      severity: "error",
      from: { path: "^src/components/" },
      to: { path: "^src/(infrastructure|ai|actions|modules|app|composition)/" },
    },
    {
      name: "composition-uses-public-module-api",
      severity: "error",
      from: { path: "^src/composition/" },
      to: { path: "^src/modules/[^/]+/.+", pathNot: "^src/modules/[^/]+/index\.ts$" },
    },
    {
      name: "app-uses-public-module-api",
      severity: "error",
      from: { path: "^src/app/" },
      to: { path: "^src/modules/[^/]+/.+", pathNot: "^src/modules/[^/]+/index\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "types"] },
    exclude: { path: "\\.next/" },
  },
};
