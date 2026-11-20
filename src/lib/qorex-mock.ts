// Thin re-export so the dev-only QoreX mock loads as a separate chunk,
// only when ?mock-qorex=1 is present (see qorex.ts maybeInstallQorexMock).
// Never imported in production builds.
export { createQorexMock } from "@qorechain/qorex-wallet-mock";
