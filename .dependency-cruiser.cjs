// Code boundaries from spec section 4, enforced in CI (`pnpm depcruise`).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "web-not-relay",
      comment: "apps/web may import protocol and crypto, never the relay (4).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^apps/relay/" },
    },
    {
      name: "relay-no-verifier-or-e2e",
      comment:
        "The relay never verifies answers and never opens envelopes (0, rule 1). From packages/crypto it may import only device-auth (and the bytes helpers it uses).",
      severity: "error",
      from: { path: "^apps/relay/" },
      to: { path: "^packages/crypto/src/", pathNot: "^packages/crypto/src/(device-auth|bytes)\\.ts$" },
    },
    {
      name: "relay-not-web",
      severity: "error",
      from: { path: "^apps/relay/" },
      to: { path: "^apps/web/" },
    },
    {
      name: "crypto-webcrypto-only",
      comment: "packages/crypto uses WebCrypto only: no npm packages and no Node or DOM modules (4).",
      severity: "error",
      from: { path: "^packages/crypto/src/" },
      to: { pathNot: "^packages/crypto/src/" },
    },
    {
      name: "protocol-zod-only",
      comment: "packages/protocol may import zod and nothing else (4).",
      severity: "error",
      from: { path: "^packages/protocol/src/" },
      to: { pathNot: "^packages/protocol/src/|/node_modules/zod/" },
    },
    {
      name: "packages-not-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-circular",
      comment: "No runtime import cycles. Cycles through `import type` edges vanish at runtime and are allowed.",
      severity: "error",
      from: { path: "^(packages|apps/relay)/" },
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(/test/|/tests/|\\.test\\.ts$|/fixtures/)" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
    tsConfig: { fileName: "tsconfig.depcruise.json" },
  },
};
