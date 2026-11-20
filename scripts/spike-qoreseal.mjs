import { generateSealKeys, seal, open, recipientOf, envelopeToText, envelopeFromText, deriveSealKeys, sealSeedFromMnemonic } from "@qorechain/qoreseal";
import { fetchKemKey, sealToAddresses } from "@qorechain/qoreseal/network";
import { sha3_256 } from "@noble/hashes/sha3.js";

const CHAIN = "qorechain-diana";
const PURPOSE = "q-will";
const MSG = "Anakku, jaga ibumu. Kunci brankas ada di laci kedua. — Ayah";

console.log("== Test 1: offline seal/open round-trip (ML-KEM-1024 + X25519 hybrid) ==");
const bob = generateSealKeys();
const env = seal({ chainId: CHAIN, purpose: PURPOSE, recipients: [recipientOf(bob)], plaintext: new TextEncoder().encode(MSG) });
console.log("envelope bytes:", env.length);
const text = envelopeToText(env);
console.log("envelope text chars:", text.length, "| prefix:", text.slice(0, 40));
const opened = open({ chainId: CHAIN, purpose: PURPOSE, envelope: envelopeFromText(text), keys: bob });
console.log("round-trip OK:", new TextDecoder().decode(opened) === MSG);
console.log("envelope sha3-256:", Buffer.from(sha3_256(env)).toString("hex"));

console.log("\n== Test 2: wrong keys cannot open ==");
const mallory = generateSealKeys();
try { open({ chainId: CHAIN, purpose: PURPOSE, envelope: env, keys: mallory }); console.log("FAIL: opened with wrong keys"); }
catch (e) { console.log("OK rejected:", e.code || e.message); }

console.log("\n== Test 3: wrong purpose cannot open ==");
try { open({ chainId: CHAIN, purpose: "chat", envelope: env, keys: bob }); console.log("FAIL: opened with wrong purpose"); }
catch (e) { console.log("OK rejected:", e.code || e.message); }

console.log("\n== Test 4: deterministic keys from seed ==");
const k1 = deriveSealKeys({ mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" });
const k2 = deriveSealKeys({ mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" });
console.log("deterministic:", Buffer.from(k1.mlkemPublicKey).equals(Buffer.from(k2.mlkemPublicKey)));

console.log("\n== Test 5: fetchKemKey via library (user address, expect not registered) ==");
try {
  const st = await fetchKemKey({ rest: "https://api-testnet.qore.host", address: "qor1d3schmtf6kaa4ppzt56822rc7rfyhjdfrdwec0" });
  console.log("registered:", st.registered);
} catch (e) { console.log("fetchKemKey error:", e.code || e.message); }

console.log("\n== Test 6: sealToAddresses to unregistered address (expect KEM_KEY_NOT_REGISTERED) ==");
try {
  await sealToAddresses({ rest: "https://api-testnet.qore.host", chainId: CHAIN, purpose: PURPOSE, recipients: [{ address: "qor1d3schmtf6kaa4ppzt56822rc7rfyhjdfrdwec0" }], plaintext: new TextEncoder().encode(MSG) });
  console.log("FAIL: sealed to unregistered address");
} catch (e) { console.log("OK rejected:", e.code || e.message); }

console.log("\n== Test 7: MLKEM-only mode envelope size ==");
const envM = seal({ chainId: CHAIN, purpose: PURPOSE, mode: "mlkem", recipients: [recipientOf(bob)], plaintext: new TextEncoder().encode(MSG) });
console.log("mlkem-mode envelope bytes:", envM.length);
console.log("\nSPIKE DONE");
