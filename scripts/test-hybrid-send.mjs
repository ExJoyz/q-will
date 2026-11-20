// test-hybrid-send.mjs — Step 1/4: fund the TEST wallet, register its ML-DSA-87
// key, then send 0.001 QOR to the recipient with the seal memo from
// video/seal-demo.json, and verify the tx on-chain.
// TESTNET ONLY. Uses ONLY the test wallet in video/test-wallet.json — never the
// user's wallet. Run from ~/workspace/qorechain/q-will.
//
//   QORE_FAUCET_URL=https://<faucet-endpoint> node scripts/test-hybrid-send.mjs
// If QORE_FAUCET_URL is unset the faucet step is skipped: fund the test
// address first (Dashboard faucet accepts any qor1 address) and re-run;
// the script proceeds once the balance is > 0.
import {
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  ensurePqcRegistered,
  fetchPqcStatus,
  requestFaucet,
  toBase,
} from "@qorechain/sdk";
import { readFileSync, writeFileSync } from "node:fs";

const REST = "https://api-testnet.qore.host";
const RECIPIENT = "qor1cycgckmh2vxcclsmxlh0ee2d3c996pkqdf6nty";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wallet = JSON.parse(readFileSync("./video/test-wallet.json", "utf8"));
const demo = JSON.parse(readFileSync("./video/seal-demo.json", "utf8"));
if (!demo.memo || !demo.envelopeText) throw new Error("seal-demo.json is missing memo/envelopeText — run step 2 first");
console.log("test address:", wallet.address);
console.log("memo:", demo.memo);

const client = createClient();
console.log("REST endpoint:", client.network.endpoints.rest);

async function balanceOf(address) {
  const res = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${address}`);
  if (!res.ok) throw new Error(`balance read HTTP ${res.status}`);
  const data = await res.json();
  const row = (data.balances ?? []).find((b) => b.denom === "uqor");
  return row ? BigInt(row.amount) : 0n;
}

let balance = await balanceOf(wallet.address);
console.log("balance before funding:", balance.toString(), "uqor");

if (balance === 0n) {
  const faucetUrl = process.env.QORE_FAUCET_URL;
  if (!faucetUrl) {
    throw new Error(
      "Test wallet is unfunded and QORE_FAUCET_URL is not set. Fund qor1yjlerk6ym8zt3w4vegwjqpzyhdzecrpehrn0cr via the Dashboard faucet (it accepts any qor1 address, sign-in required) and re-run.",
    );
  }
  console.log("requesting faucet:", faucetUrl);
  const faucetRes = await requestFaucet(client.network, wallet.address, { faucetUrl });
  console.log("faucet response:", JSON.stringify(faucetRes));
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    balance = await balanceOf(wallet.address);
    console.log(`balance poll ${i + 1}:`, balance.toString(), "uqor");
    if (balance > 0n) break;
  }
  if (balance === 0n) throw new Error("Faucet claimed but balance is still 0 after ~150s");
}

const account = await deriveNativeAccount(wallet.mnemonic);
if (account.address !== wallet.address) throw new Error("derived address mismatch — wrong mnemonic file");
const pqcKeypair = derivePqcCanonical(account.address, wallet.mnemonic);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
const tx = await client.connectTx(signer, { pqcKeypair });
console.log("tx client sender:", tx.senderAddress);

const statusBefore = await fetchPqcStatus({ rest: REST, address: wallet.address });
console.log("PQC status before:", JSON.stringify(statusBefore));

await ensurePqcRegistered(tx, { pqcKeypair, rest: client.network.endpoints.rest });
console.log("ensurePqcRegistered done");

const statusAfter = await fetchPqcStatus({ rest: REST, address: wallet.address });
console.log("PQC status after:", JSON.stringify(statusAfter));
if (!statusAfter.registered) throw new Error("PQC key still not registered after ensurePqcRegistered");

console.log(`sending 0.001 QOR to ${RECIPIENT} with memo ${demo.memo}`);
const result = await tx.bankSend(RECIPIENT, [{ denom: "uqor", amount: toBase("0.001") }], {
  memo: demo.memo,
});
console.log("bankSend result:", JSON.stringify(result, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
const txHash = result.transactionHash;
if (!txHash) throw new Error("bankSend returned no transactionHash");
console.log("TX HASH:", txHash);

// Verify on-chain by hash (the only reliable read; tx-history list 500s).
let verified = null;
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const res = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${txHash}`);
  if (res.status === 404) {
    console.log(`verify poll ${i + 1}: not indexed yet`);
    continue;
  }
  if (!res.ok) throw new Error(`tx read HTTP ${res.status}`);
  const data = await res.json();
  const txResp = data.tx_response ?? {};
  const memoOnChain = data.tx?.body?.memo ?? null;
  verified = {
    txHash,
    height: txResp.height ?? null,
    code: txResp.code ?? null,
    memoOnChain,
    memoMatches: memoOnChain === demo.memo,
    rawLog: txResp.raw_log ?? null,
  };
  console.log("verified on-chain:", JSON.stringify(verified));
  break;
}
if (!verified) throw new Error("tx not indexed after ~60s — check hash manually");
if (verified.code !== 0) throw new Error(`tx failed on-chain with code ${verified.code}`);
if (!verified.memoMatches) throw new Error("memo on-chain does NOT match the seal memo");

const txJson = {
  ...verified,
  recipient: RECIPIENT,
  amountUqor: "1000",
  sender: wallet.address,
  pqcRegistered: statusAfter.registered,
  pqcAlgorithmId: statusAfter.algorithmId ?? null,
  explorerTxUrl: `https://explore.qore.network/tx/${txHash}?network=testnet`,
  explorerAddressUrl: `https://explore.qore.network/address/${wallet.address}?network=testnet`,
  createdAt: new Date().toISOString(),
};
writeFileSync("./video/tx.json", JSON.stringify(txJson, null, 2));
console.log("wrote video/tx.json");
console.log("DONE — real hybrid-signed seal tx verified on-chain");
