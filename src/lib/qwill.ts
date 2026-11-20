// Q-Will core — seal a last message to a recipient with QoreSeal (ML-KEM-1024)
// and anchor it on-chain with ONE native hybrid-signed bank send.
//
// Design (SealedDrop — see README.md "Spike QoreSeal" for why this, and not the
// on-chain KEM registry, is the design):
//   1. The recipient's seal keys live in THEIR browser (localStorage), generated
//      by this app. They are app keys, NOT the wallet mnemonic — the app never
//      sees or asks for a seed phrase. The recipient shares only the PUBLIC half
//      ("key card") with the sender.
//   2. The sender seals the message offline with @qorechain/qoreseal. The
//      envelope (~1.8 KB) travels OFF-chain in a share link — it can never fit
//      in a transaction memo (chain max 256 chars, QoreX max 256 bytes).
//   3. The sender anchors the envelope on-chain with one native bank send
//      (0.001 QOR) to the recipient. Its memo carries only:
//      `QWILL1:<sha3-256(envelope) hex>:<release unix seconds>` (~83 chars).
//      QoreX hybrid-signs every native transfer (secp256k1 + ML-DSA-87), so
//      this one transaction IS the required hybrid-signed transaction.
//   4. After the release date, the recipient opens the link: the app verifies
//      the anchor by fetching the transaction BY HASH
//      (GET /cosmos/tx/v1beta1/txs/{hash}) — never the tx-history list endpoint,
//      which answers 500 on this testnet — then opens the envelope with the
//      recipient's local seal keys.

import type {
  SealKeyPair,
  SealRecipient,
} from "@qorechain/qoreseal";
import { sha3_256 } from "@noble/hashes/sha3.js";
// NOTE: cosmjs-types 0.11 exports "./*.js": null, so subpaths are imported
// WITHOUT the .js extension (its "./*" mapping resolves them).
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

// @qorechain/qoreseal is heavy (ML-KEM-1024). It is loaded on demand, so the
// first paint stays light; every seal/open flow awaits it when the user acts.
// Type-only imports above are erased at compile time and cost nothing.
type QoreSealModule = typeof import("@qorechain/qoreseal");
let qoresealPromise: Promise<QoreSealModule> | null = null;
function loadQoreSeal(): Promise<QoreSealModule> {
  if (!qoresealPromise) qoresealPromise = import("@qorechain/qoreseal");
  return qoresealPromise;
}

export const QWILL_CHAIN_ID = "qorechain-diana";
export const QWILL_PURPOSE = "q-will";
export const QWILL_MEMO_PREFIX = "QWILL1";
export const QWILL_SEAL_AMOUNT_UQOR = "1000"; // 0.001 QOR — the seal is symbolic.
export const QWILL_SEAL_GAS_LIMIT = 400_000;
export const QWILL_SEED_STORAGE_KEY = "qwill:seal-seed:v1";

export function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA3-256 of the envelope bytes, hex — the value the on-chain memo anchors. */
export function hashEnvelopeHex(envelope: Uint8Array): string {
  return hexOf(sha3_256(envelope));
}

// ─── Memo: the on-chain anchor ──────────────────────────────────────────────

export function buildSealMemo(envelopeHashHex: string, releaseUnix: number): string {
  const memo = `${QWILL_MEMO_PREFIX}:${envelopeHashHex}:${releaseUnix}`;
  if (new TextEncoder().encode(memo).length > 256) {
    throw new Error(`Seal memo is ${memo.length} bytes, over the 256-byte limit.`);
  }
  return memo;
}

export interface ParsedSealMemo {
  envelopeHash: string;
  releaseUnix: number;
}

export function parseSealMemo(memo: string): ParsedSealMemo | null {
  const parts = memo.split(":");
  if (parts.length !== 3 || parts[0] !== QWILL_MEMO_PREFIX) return null;
  if (!/^[0-9a-f]{64}$/.test(parts[1])) return null;
  const releaseUnix = Number(parts[2]);
  if (!Number.isInteger(releaseUnix) || releaseUnix <= 0) return null;
  return { envelopeHash: parts[1], releaseUnix };
}

// ─── Recipient seal keys: browser-local keystore ────────────────────────────
//
// The seed (32 bytes) is the only secret. It is generated here, stored only in
// this browser's localStorage, and never sent anywhere. Clearing browser data
// loses access to sealed messages — the README states this plainly. This is a
// demo-grade keystore: production would use wallet-native decryption (which
// QoreX does not expose to dApps today — see README "Spike QoreSeal").

export async function getOrCreateSealKeys(): Promise<SealKeyPair> {
  const qs = await loadQoreSeal();
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(QWILL_SEED_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored) {
    try {
      return qs.sealKeysFromSeed(qs.fromBase64Url(stored));
    } catch {
      // Corrupt entry: fall through and generate fresh keys.
    }
  }
  const keys = qs.generateSealKeys();
  try {
    window.localStorage.setItem(QWILL_SEED_STORAGE_KEY, qs.toBase64Url(keys.seed));
  } catch {
    // Storage unavailable (private mode etc.) — keys live only for this page.
  }
  return keys;
}

export function hasLocalSealKeys(): boolean {
  try {
    return window.localStorage.getItem(QWILL_SEED_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// ─── Recipient key card: the PUBLIC half, shared with the sender ────────────

export interface KeyCard {
  v: 1;
  kind: "qwill-key-card";
  address?: string;
  mlkemPublicKey: string; // base64url, 1568 bytes
  x25519PublicKey: string; // base64url, 32 bytes
}

export async function exportKeyCard(keys: SealKeyPair, address?: string): Promise<KeyCard> {
  const qs = await loadQoreSeal();
  return {
    v: 1,
    kind: "qwill-key-card",
    ...(address ? { address } : {}),
    mlkemPublicKey: qs.toBase64Url(keys.mlkemPublicKey),
    x25519PublicKey: qs.toBase64Url(keys.x25519PublicKey),
  };
}

export function keyCardToText(card: KeyCard): string {
  return JSON.stringify(card);
}

export async function parseKeyCard(text: string): Promise<SealRecipient> {
  const qs = await loadQoreSeal();
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    // Accept base64url-encoded JSON as well (compact share form).
    try {
      raw = JSON.parse(new TextDecoder().decode(qs.fromBase64Url(text.trim())));
    } catch {
      throw new Error("Key card unreadable: not a Q-Will key card JSON.");
    }
  }
  const card = raw as Partial<KeyCard>;
  if (card.kind !== "qwill-key-card" || !card.mlkemPublicKey || !card.x25519PublicKey) {
    throw new Error("Invalid key card: not a Q-Will key card.");
  }
  const recipient: SealRecipient = {
    mlkemPublicKey: qs.fromBase64Url(card.mlkemPublicKey),
    x25519PublicKey: qs.fromBase64Url(card.x25519PublicKey),
  };
  if (recipient.mlkemPublicKey.length !== 1568) {
    throw new Error("Invalid key card: ML-KEM key must be 1568 bytes.");
  }
  if (recipient.x25519PublicKey?.length !== 32) {
    throw new Error("Invalid key card: X25519 key must be 32 bytes.");
  }
  return recipient;
}

// ─── Seal / open ────────────────────────────────────────────────────────────

export interface SealedWill {
  envelope: Uint8Array;
  envelopeText: string; // "qoreseal:..." — safe to put in a link fragment
  envelopeHash: string; // sha3-256 hex, anchored on-chain
}

export async function sealWillMessage(
  plaintext: string,
  recipient: SealRecipient,
): Promise<SealedWill> {
  const qs = await loadQoreSeal();
  // Hybrid mode needs BOTH keys; a card without X25519 cannot be sealed to.
  if (!recipient.x25519PublicKey) {
    throw new Error("Recipient key card has no X25519 key (hybrid mode needs both).");
  }
  const envelope = qs.seal({
    chainId: QWILL_CHAIN_ID,
    purpose: QWILL_PURPOSE,
    recipients: [
      qs.recipientOf({
        mlkemPublicKey: recipient.mlkemPublicKey,
        x25519PublicKey: recipient.x25519PublicKey,
      }),
    ],
    plaintext: new TextEncoder().encode(plaintext),
  });
  return {
    envelope,
    envelopeText: qs.envelopeToText(envelope),
    envelopeHash: hashEnvelopeHex(envelope),
  };
}

export async function openWillEnvelope(envelopeText: string, keys: SealKeyPair): Promise<string> {
  const qs = await loadQoreSeal();
  const envelope = qs.envelopeFromText(envelopeText.trim());
  const plaintext = qs.open({
    chainId: QWILL_CHAIN_ID,
    purpose: QWILL_PURPOSE,
    envelope,
    keys,
  });
  return new TextDecoder().decode(plaintext);
}

/** Decode envelope text and return its SHA3-256 hash hex (for anchor checks). */
export async function hashEnvelopeTextHex(envelopeText: string): Promise<string> {
  const qs = await loadQoreSeal();
  return hashEnvelopeHex(qs.envelopeFromText(envelopeText.trim()));
}

// ─── Anchor verification (tx by hash — never the tx-history list) ───────────

export interface AnchorCheck {
  ok: boolean;
  reasons: string[];
  txHash: string;
  memo: string | null;
  releaseUnix: number | null;
  released: boolean;
}

interface RestTxResponse {
  tx?: {
    body?: {
      memo?: string;
      // The chain's REST returns messages in the JSON-decoded (Amino) shape:
      // "@type" + plain fields (to_address/from_address/amount). Older docs
      // show the protobuf Any shape (type_url + base64 value) — accept both.
      messages?: {
        type_url?: string;
        value?: string;
        "@type"?: string;
        to_address?: string;
        from_address?: string;
        amount?: { denom?: string; amount?: string }[];
      }[];
    };
  };
  tx_response?: { code?: number | string; height?: string };
}

/** Fetch a transaction by hash through the REST/LCD proxy and check the seal. */
export async function verifySealAnchor(
  rest: string,
  args: {
    txHash: string;
    envelopeHash: string;
    recipient: string;
    releaseUnix: number;
  },
): Promise<AnchorCheck> {
  const reasons: string[] = [];
  const base: AnchorCheck = {
    ok: false,
    reasons,
    txHash: args.txHash,
    memo: null,
    releaseUnix: null,
    released: Date.now() / 1000 >= args.releaseUnix,
  };
  let res: Response;
  try {
    res = await fetch(`${rest.replace(/\/$/, "")}/cosmos/tx/v1beta1/txs/${args.txHash}`);
  } catch (err) {
    reasons.push(`Could not read the transaction: ${err instanceof Error ? err.message : String(err)}`);
    return base;
  }
  if (res.status === 404) {
    reasons.push("Transaction not found on-chain (wrong hash / not included yet?).");
    return base;
  }
  if (!res.ok) {
    if (res.status === 500) {
      // The chain answers 500 (not 404) for a hash that is not exactly 64
      // hex characters — odd length gives "odd length hex string", non-hex
      // gives "invalid byte". Verified live 20 Nov 2026.
      reasons.push(
        "Chain answered HTTP 500 — the transaction hash is probably incomplete or mistyped (the chain only accepts exactly 64 hex characters). Copy the full Tx hash from section 3.",
      );
    } else {
      reasons.push(`Chain answered HTTP ${res.status} while reading the transaction.`);
    }
    return base;
  }
  const data = (await res.json()) as RestTxResponse;
  const code = Number(data.tx_response?.code ?? -1);
  if (code !== 0) {
    reasons.push(`Transaction failed on-chain (code ${data.tx_response?.code}).`);
    return base;
  }
  const memo = data.tx?.body?.memo ?? null;
  base.memo = memo;
  if (!memo) {
    reasons.push("Transaction has no seal memo.");
    return base;
  }
  const parsed = parseSealMemo(memo);
  if (!parsed) {
    reasons.push("Transaction memo is not a Q-Will seal.");
    return base;
  }
  base.releaseUnix = parsed.releaseUnix;
  if (parsed.envelopeHash !== args.envelopeHash) {
    reasons.push("Envelope hash in the memo does NOT match this envelope.");
    return base;
  }
  if (parsed.releaseUnix !== args.releaseUnix) {
    reasons.push("Release date in the memo differs from the requested one.");
    return base;
  }
  const messages = data.tx?.body?.messages ?? [];
  const send = messages.find(
    (m) =>
      m.type_url === "/cosmos.bank.v1beta1.MsgSend" ||
      m["@type"] === "/cosmos.bank.v1beta1.MsgSend",
  );
  if (!send) {
    reasons.push("Transaction is not a seal bank send.");
    return base;
  }
  // Protobuf Any shape: decode the base64 value. JSON shape: read the plain
  // to_address field the REST endpoint returns.
  let toAddress: string | null = null;
  if (send.type_url && send.value) {
    try {
      const decoded = MsgSend.decode(Uint8Array.from(atob(send.value), (c) => c.charCodeAt(0)));
      toAddress = decoded.toAddress;
    } catch {
      reasons.push("Bank send message could not be decoded.");
      return base;
    }
  } else {
    toAddress = send.to_address ?? null;
  }
  if (!toAddress) {
    reasons.push("Bank send message could not be decoded.");
    return base;
  }
  if (toAddress !== args.recipient) {
    reasons.push(`Recipient in the transaction (${toAddress}) is not ${args.recipient}.`);
    return base;
  }
  if (!base.released) {
    reasons.push(
      `Seal is valid, but the release date has not arrived yet (${new Date(args.releaseUnix * 1000).toISOString()}).`,
    );
    return base;
  }
  base.ok = true;
  reasons.push("Seal verified on-chain: hash matches, recipient matches, release date passed.");
  return base;
}
