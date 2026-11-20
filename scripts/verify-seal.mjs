// verify-seal.mjs — offline integrity check of video/seal-demo.json using the
// app's own code path (@qorechain/qoreseal + sha3-256): the sha3-256 of the
// envelope bytes must equal the hash embedded in the memo.
import { envelopeFromText } from "@qorechain/qoreseal";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { readFileSync } from "node:fs";

const demo = JSON.parse(readFileSync("./video/seal-demo.json", "utf8"));
const bytes = envelopeFromText(demo.envelopeText);
const hash = Buffer.from(sha3_256(bytes)).toString("hex");
console.log("envelope bytes:", bytes.length, "(seal-demo says", demo.envelopeBytes + ")");
console.log("computed hash:", hash);
console.log("memo hash:    ", demo.envelopeHash);
console.log("memo:         ", demo.memo);
console.log("release unix: ", demo.releaseUnix, new Date(demo.releaseUnix * 1000).toISOString());
console.log("HASH MATCH:", hash === demo.envelopeHash);
if (hash !== demo.envelopeHash || bytes.length !== demo.envelopeBytes) {
  process.exit(1);
}
console.log("SEAL INTEGRITY OK");
