// gen-test-wallet.mjs — generate the FRESH TEST wallet for the Q-Will e2e test.
// TESTNET ONLY. Never the user's wallet. Run from ~/workspace/qorechain/q-will.
import { generateMnemonic, deriveNativeAccount, derivePqcCanonical } from "@qorechain/sdk";
import { writeFileSync, chmodSync } from "node:fs";

const mnemonic = generateMnemonic();
const account = await deriveNativeAccount(mnemonic);
const pqc = derivePqcCanonical(account.address, mnemonic);

const wallet = {
  label: "Q-Will e2e TEST wallet — TESTNET ONLY, no real value",
  createdAt: new Date().toISOString(),
  mnemonic,
  address: account.address,
  // EVM/SVM derivations are not needed for this test; only native is used.
  pqcPublicKeyBase64: Buffer.from(pqc.publicKey).toString("base64"),
};
writeFileSync("./video/test-wallet.json", JSON.stringify(wallet, null, 2));
chmodSync("./video/test-wallet.json", 0o600);
console.log("TEST address:", account.address);
console.log("PQC pubkey (b64, first 40):", wallet.pqcPublicKeyBase64.slice(0, 40) + "…");
console.log("saved video/test-wallet.json (0600)");
