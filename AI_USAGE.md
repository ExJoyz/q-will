# AI Usage — Q-Will

This project was built with AI assistance (Muse Spark 1.3, "Leng"), as part of
the QoreChain Developer Fest "Build Before Q-Day" — Quantum Pass.

## What the AI did

- Researched the fest rules, the QoreChain SDK 0.14.0, QoreSeal 0.1.0, and the
  QoreX wallet integration, and chose the Q-Will concept.
- Scaffolded the app from the official `create-qorechain-dapp@0.14.0`
  (`fullstack-web` template), then wrote the Q-Will code in `src/`:
  `src/lib/qwill.ts` (QoreSeal seal/open, memo anchor, anchor verification),
  `src/lib/qorex.ts` (QoreX connect + hybrid-signed seal transaction),
  `src/App.tsx` (create/open will UI).
- Ran the QoreSeal spike (`scripts/spike-qoreseal.mjs`, `npm run spike`):
  offline ML-KEM-1024 + X25519 seal/open round-trip, wrong-key/wrong-purpose
  rejection, deterministic key derivation, and the on-chain KEM registry read
  that proved the recipient had no registered KEM key
  (`KEM_KEY_NOT_REGISTERED`).
- Verified live testnet facts with curl: builder balance 9,055,000 uqor,
  PQC account registered, KEM key not registered, tx-by-hash endpoint alive,
  tx-history list endpoint returning 500, `max_memo_characters: 256`, and the
  public REST API sending no CORS headers.

## What a human did / must do

- Robert Amsterdam (GitHub ExJoyz, X @araggoorn) registered for the fest,
  connected QoreX on testnet, and owns the testnet address below.
- All on-chain actions (the seal transaction) are signed by the human in QoreX
  on their own phone. The AI never held, requested, or entered any seed phrase
  or private key, created no wallet, and sent no transaction.
- Human review is required before the fest submission: the demo video, the
  cover image, and the final "New project" entry on build.qorechain.io.

## AI-built, human-owned

The idea, the code, and the test results are the human's to keep, change, and
submit. This file exists so the work is transparent about how much of it an AI
produced — the Best AI-Native Build track asks for exactly this disclosure.
