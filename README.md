# Q-Will — Quantum-Resistant Digital Will

**QoreChain Developer Fest "Build Before Q-Day" — Quantum Pass.**

Write a final message, seal it with QoreSeal (ML-KEM-1024, FIPS 203), and anchor
the seal on the QoreChain testnet with **one hybrid-signed transaction**
(secp256k1 + ML-DSA-87). The recipient opens it after the release date — and only
the recipient can open it.

- **Testnet:** `qorechain-diana` (EVM 9800)
- **Builder testnet address:** `qor1d3schmtf6kaa4ppzt56822rc7rfyhjdfrdwec0`
  (`0x6c618bed69d5bbda84225d34752878f0d24bc9a9`)
- **Live app:** https://q-will.vercel.app
- **Demo video:** https://youtu.be/LJa45flMxVU (1:53)
- **Fest project:** https://build.qorechain.io/p/q-will-quantum-resistant-digital-will
- **Builder:** Robert Amsterdam — GitHub
  [ExJoyz](https://github.com/ExJoyz) · X
  [@araggoorn](https://x.com/araggoorn)
- **License:** MIT
- **AI usage:** see [`AI_USAGE.md`](AI_USAGE.md) — this build was made with
  AI assistance (Best AI-Native Build).

## Why this matters (Q-Day)

The "harvest now, decrypt later" threat: classically encrypted messages
harvested today can be opened by a quantum computer later. Q-Will seals the
message with ML-KEM-1024 — a post-quantum key — and proves the seal on-chain
with a hybrid signature, so your will stays secret until its time comes, even
after Q-Day.

## How it works

1. **The recipient prepares seal keys** (section 2 in the app): keys are created
   and stored ONLY in the recipient's browser (localStorage). Only the
   *key card* (public key) is shared. The app never asks for a seed phrase.
2. **The sender seals the message** (section 3): the message is encrypted
   offline with `@qorechain/qoreseal` to the recipient's key card. The envelope
   (~1.8 KB) does NOT go on-chain — the transaction memo is limited to 256
   characters.
3. **The sender sends the seal on-chain**: one native bank send of 0.001 QOR to
   the recipient, memo `QWILL1:<sha3-256(envelope) hex>:<release date unix>`.
   QoreX hybrid-signs this transaction (secp256k1 + ML-DSA-87) — this is the
   **one hybrid-signed transaction** required by Quantum Pass.
4. **The recipient opens it** (section 4, after the release date): the app fetches
   the transaction BY HASH (`GET /cosmos/tx/v1beta1/txs/{hash}`), checks the
   memo matches the envelope hash + recipient + release date, then decrypts
   the envelope with the recipient's local seal keys.

## Architecture

```
Browser (Vite + React + TypeScript)
├── src/lib/qwill.ts   — QoreSeal seal/open, seal memo, anchor verification
├── src/lib/qorex.ts   — connect QoreX, send seal via signAndBroadcast
├── src/lib/qorex-mock.ts — mock QoreX (dev only, ?mock-qorex=1)
└── src/App.tsx        — UI: connect / seal keys / create / open

Chain (testnet qorechain-diana)
└── bank send 0.001 QOR + memo QWILL1:… (the only on-chain write)
```

No smart contract: the seal is a native transaction + memo. No server: the
envelope travels via a link (`#/open?e=…&tx=…`), its hash bound in the on-chain
memo.

## Running it

```sh
npm install
npm run dev    # http://localhost:5173
```

| Variable | Purpose | Value |
| -------- | ------- | ----- |
| `VITE_QORE_REST_URL` | Native REST | `/lcd` (dev-server proxy) |
| `QORE_REST_PROXY_TARGET` | `/lcd` target | `https://api-testnet.qore.host` |
| `VITE_QORE_EVM_RPC_URL` | EVM JSON-RPC | `https://evm-testnet.qore.host` |

The public REST sends no CORS headers, so the browser uses the Vite proxy
(`/lcd`, see `vite.config.ts`). For production, the same proxy is provided as
a Vercel serverless function (`api/lcd.js`, reached from `/lcd/*` by the
`vercel.json` rewrite as `/api/lcd?path=/...`). Note: the first version used
a catch-all file `api/lcd/[...path].js`, but Vercel only matched one path
segment for it, so the proxy now reads the REST path from the `path` query
parameter instead.

## Deploy (Vercel)

Live at https://q-will.vercel.app (Hobby, auto-deploys on push to `main`).

1. In the Vercel dashboard: **Add New → Project → Import** repo
   `ExJoyz/q-will`. The framework is auto-detected (Vite).
2. Build command `npm run build`, output directory `dist` (already in
   `vercel.json`, no changes needed).
3. Deploy. Open the deployed URL in the QoreX in-app browser (Testnet)
   and test sections 1–4 as below.
4. No environment variables are required: the `/lcd` proxy already points
   to `https://api-testnet.qore.host` inside the function.

## Testing from your phone (real QoreX)

1. Open the deployed URL in the **QoreX in-app browser** (or Chrome with the
   QoreX extension, Testnet).
2. Top up test QOR from the faucet https://dashboard.qorechain.io/faucet if
   the balance is low (a seal costs ~0.001 QOR + fee).
3. Section 1: connect QoreX. Section 2: create a key card (in the recipient's
   browser).
4. Section 3: write a message, paste the recipient's address + key card, pick
   a release date, click "Seal message", then "Send seal on-chain" and
   **approve in QoreX**.
5. Share the open link with the recipient. After the release date, the
   recipient opens the link, the app verifies the seal on-chain, then the
   message opens.

Mock mode (`?mock-qorex=1`, dev only) uses the official mock wallet
(`@qorechain/qorex-wallet-mock`) to test the connection UI on desktop —
**sending transactions is disabled in mock mode**; test sending only from
your phone with the real QoreX.

## Verifying the hybrid-signed transaction

1. Take the seal transaction hash from the app (section 3).
2. Read the transaction:
   `GET https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<hash>`
   (or through the app's proxy: `/lcd/cosmos/tx/v1beta1/txs/<hash>`).
3. Check: `tx_response.code == 0`, `tx.body.memo` is shaped
   `QWILL1:<sha3-256 hex>:<unix>`, and the `MsgSend` goes to the recipient's
   address.
4. Check the post-quantum layer: the transaction carries the hybrid signature
   extension (ML-DSA-87) for the key registered at
   `GET /qorechain/pqc/v1/account/<address>`.

**Verified example (21 Nov 2026):** hash
`A1FA94FEC192E9EF64055B91C42315397BB2DE8BCDECBE02D44056BC0F0FE620`, height
10445074, code 0, memo
`QWILL1:8e1e0d430a70af68beb6c66bc6e680121382af976301dd6684187aa42cacbf6c:1795195140`,
ML-DSA-87 (Dilithium-5), FIPS 204, NIST category 5 —
[explorer](https://explore.qore.network/tx/A1FA94FEC192E9EF64055B91C42315397BB2DE8BCDECBE02D44056BC0F0FE620?network=testnet)
(click **Testnet** on the page if it says "not found").

## QoreSeal spike — honest verdict (20 Nov 2026)

Original plan: encrypt to any qor1 address via the on-chain KEM *registry*,
then decrypt "inside QoreX". **That plan was BLOCKED on two points**,
proven directly (script: `npm run spike`, `scripts/spike-qoreseal.mjs`):

1. **The KEM registry needs a published key.** The builder's own address had
   no KEM key yet (`GET /qorechain/pqc/v1/kem/<address>` →
   `{"found":false}`), and `sealToAddresses` to that address failed with
   `KEM_KEY_NOT_REGISTERED`. More importantly: **QoreX refuses**
   `MsgRegisterKEMKey`/`MsgRemoveKEMKey` from dApps
   (`QOREX_REFUSED_TYPE_URLS` in `@qorechain/wallet-adapter`) — a dApp cannot
   register the recipient's KEM key through QoreX. So the "seal to any address"
   flow cannot work from a dApp.
2. **No QoreX decryption API for dApps.** The QoreX docs and packages
   (`@qorechain/wallet-adapter`, `@qorechain/qorex-types`) only expose
   `signAndBroadcast` (+ EVM/SVM). "Decrypt inside QoreX" is not a supported
   flow.

**What WORKED and is used (SealedDrop design, 80% same architecture):**

- Offline QoreSeal round-trip (ML-KEM-1024 + X25519 hybrid) works:
  a 1,781-byte envelope for a ~60-character message, `qoreseal:…` text of
  2,384 characters.
- Wrong key rejected (`NOT_A_RECIPIENT`), wrong purpose rejected
  (`DECRYPTION_FAILED`), keys derived deterministically from a seed.
- Seal keys are created in the recipient's browser (localStorage) and only
  the public key is shared — the encryption is still genuine ML-KEM-1024, and
  the seal is still anchored on-chain by one hybrid-signed transaction. The
  honestly stated limitation: keys are lost if browser data is wiped;
  production would need native decryption in the wallet.

## Testnet traps already handled

- **Tx history 500:** `GET /cosmos/tx/v1beta1/txs?events=…` answers HTTP 500.
  The app NEVER reads history — verification reads one transaction per hash
  (proven to answer 404 for an unknown hash, not 500).
- **REST without CORS:** the browser uses the Vite `/lcd` proxy (already in
  the `fullstack-web` template); `QORE_REST_PROXY_TARGET` in `.env` points
  to the testnet.
- **256-byte memo:** `max_memo_characters: 256` (chain) and
  `QOREX_MAX_MEMO_BYTES: 256`. The seal memo holds only hash + release date
  (~83 characters); the envelope never enters the memo.
- **QoreX refuses PQC key-management messages** — see the spike above.

## Build / type-check

```sh
npm run typecheck   # tsc --noEmit
npm run build       # type-check + vite build
npm run spike       # QoreSeal spike (node, no wallet/transaction)
```

## Status

End-to-end verified (21 Nov 2026) with a real hybrid-signed transaction:
hash `A1FA94FEC192E9EF64055B91C42315397BB2DE8BCDECBE02D44056BC0F0FE620`,
height 10445074, code 0, memo matches the envelope hash, ML-DSA-87 verified
on-chain (FIPS 204, NIST category 5). The "Verify & open" flow was tested
against that transaction: anchor verified, release date passed, message
"Inheritance" decrypted in the UI. Demo video (1:53) on YouTube, cover
1600×900, project registered in My space (Quantum Pass). Public repo
`ExJoyz/q-will`, deployed at https://q-will.vercel.app. UI in English for
the international jury.
