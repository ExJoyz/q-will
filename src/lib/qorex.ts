// QoreX wallet glue for Q-Will.
//
// A dApp CANNOT sign a QoreChain transaction itself: every transaction from an
// account with a registered post-quantum key must carry BOTH a secp256k1 and an
// ML-DSA-87 signature, and only the wallet holds the ML-DSA key. So the page
// sends MESSAGES and QoreX builds, hybrid-signs and broadcasts them
// (see @qorechain/wallet-adapter src/qorex.js).
//
// What QoreX refuses from a dApp (validateQorexRequest): all PQC key-management
// messages — including MsgRegisterKEMKey / MsgRemoveKEMKey. That is why Q-Will
// does NOT use the on-chain KEM registry (see README "Spike QoreSeal") and
// instead seals to app-level keys from a key card. The seal transaction itself
// is an ordinary MsgSend, which QoreX accepts.
//
// PQC key registration: QoreX registers the account's ML-DSA-87 key itself on
// the account's first transaction. Do NOT call the SDK's ensurePqcRegistered
// here — it needs a TxClient with local keys, which a wallet-connected dApp
// does not have. Use getPqcStatus() only to DISPLAY the status.

import {
  connectQorex,
  getQorexNative,
  hasQorexSignAndBroadcast,
  isQorexRejection,
  qorexSignAndBroadcast,
  type QorexNativeProvider,
} from "@qorechain/wallet-adapter";
// NOTE: same cosmjs-types exports quirk as in qwill.ts — no .js extension.
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";

import {
  QWILL_CHAIN_ID,
  QWILL_SEAL_AMOUNT_UQOR,
  QWILL_SEAL_GAS_LIMIT,
} from "./qwill.js";

export const QOREX_MIN_VERSION_NOTE = "QoreX extension >= 0.3.5 atau aplikasi >= 1.1.5.";

export function isQorexAvailable(): boolean {
  return getQorexNative() !== undefined;
}

export function isMockQorex(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __qorexMock?: unknown }).__qorexMock !== undefined
  );
}

export interface ConnectedWallet {
  provider: QorexNativeProvider;
  /** qor1... address of the connected account. */
  address: string;
}

/**
 * Connect QoreX for qorechain-diana and return the active account address.
 * Throws a human-readable error when QoreX is missing or too old.
 */
export async function connectQorexWallet(): Promise<ConnectedWallet> {
  const provider = getQorexNative();
  if (!provider) {
    throw new Error(
      "QoreX tidak ditemukan di browser ini. Pasang ekstensi QoreX, atau buka halaman ini di browser dalam aplikasi QoreX.",
    );
  }
  if (!hasQorexSignAndBroadcast(provider)) {
    throw new Error(
      `QoreX ini terlalu lama untuk menandatangani transaksi. Perbarui QoreX (${QOREX_MIN_VERSION_NOTE}).`,
    );
  }
  await connectQorex({ chainId: QWILL_CHAIN_ID, provider });
  // getKey is on the provider per @qorechain/qorex-types (QorexKey shape,
  // Keplr-style), but @qorechain/wallet-adapter types the provider narrower.
  const key = await (
    provider as unknown as {
      getKey(chainId: string): Promise<{ bech32Address: string }>;
    }
  ).getKey(QWILL_CHAIN_ID);
  if (!key?.bech32Address) {
    throw new Error("QoreX terhubung tapi tidak memberikan alamat akun.");
  }
  return { provider, address: key.bech32Address };
}

export interface SealTxResult {
  txHash: string;
  code: number;
  height?: number | string;
}

/**
 * Send the seal: one native bank send of 0.001 QOR to the recipient, memo =
 * the Q-Will anchor. QoreX hybrid-signs it (secp256k1 + ML-DSA-87).
 *
 * HARD RULE (fest foundation): never broadcast from a mock wallet on this VM.
 * The mock exists only so the connect UI can be exercised in a desktop
 * browser. A real broadcast is tested from the user's phone, with real QoreX.
 */
export async function sendSealTx(args: {
  from: string;
  to: string;
  memo: string;
}): Promise<SealTxResult> {
  if (isMockQorex()) {
    throw new Error(
      "Mode mock QoreX: pengiriman transaksi DINONAKTIFKAN di VM ini. " +
        "Uji pengiriman segel dari HP dengan QoreX asli — lihat README 'Cara menguji dari HP'.",
    );
  }
  const msg = MsgSend.fromPartial({
    fromAddress: args.from,
    toAddress: args.to,
    amount: [Coin.fromPartial({ denom: "uqor", amount: QWILL_SEAL_AMOUNT_UQOR })],
  });
  const value = MsgSend.encode(msg).finish();
  const result = await qorexSignAndBroadcast({
    chainId: QWILL_CHAIN_ID,
    messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value }],
    memo: args.memo,
    gasLimit: QWILL_SEAL_GAS_LIMIT,
  });
  if (result.code !== 0) {
    throw new Error(`Transaksi segel ditolak chain (code ${result.code}).`);
  }
  return { txHash: result.txHash, code: result.code, height: result.height };
}

export function isUserRejection(err: unknown): boolean {
  return isQorexRejection(err);
}

/** Read-only: is this address's ML-DSA-87 key registered on chain? */
export async function getPqcStatus(
  rest: string,
  address: string,
): Promise<{ found: boolean; publicKey?: string }> {
  const res = await fetch(
    `${rest.replace(/\/$/, "")}/qorechain/pqc/v1/account/${address}`,
  );
  if (!res.ok) return { found: false };
  const data = (await res.json()) as { found?: boolean; account?: { public_key?: string } };
  return { found: data.found === true, publicKey: data.account?.public_key };
}

// ─── Dev-only QoreX mock ────────────────────────────────────────────────────
//
// Installs the official QoreX test double (@qorechain/qorex-wallet-mock) so the
// connect UI can be exercised in a desktop browser without real QoreX. DEV
// ONLY, enabled with ?mock-qorex=1. The mock signs with the PUBLIC test
// mnemonic from its own docs — testnet only, never fund it, never use it for
// anything real. Broadcasts stay blocked (see sendSealTx).

export async function maybeInstallQorexMock(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  if (!new URLSearchParams(window.location.search).has("mock-qorex")) return false;
  if (isQorexAvailable() || isMockQorex()) return false;
  const { createQorexMock } = await import("./qorex-mock.js");
  const mock = createQorexMock({ profile: "current" });
  mock.install(window);
  return true;
}
