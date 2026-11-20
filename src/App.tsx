import { useEffect, useState } from "react";

import {
  buildSealMemo,
  exportKeyCard,
  getOrCreateSealKeys,
  hasLocalSealKeys,
  hashEnvelopeTextHex,
  keyCardToText,
  openWillEnvelope,
  parseKeyCard,
  sealWillMessage,
  verifySealAnchor,
  QWILL_CHAIN_ID,
  QWILL_SEAL_AMOUNT_UQOR,
  type SealedWill,
} from "./lib/qwill.js";
import {
  connectQorexWallet,
  getPqcStatus,
  isMockQorex,
  isQorexAvailable,
  isUserRejection,
  maybeInstallQorexMock,
  sendSealTx,
} from "./lib/qorex.js";

// Endpoints come from Vite env vars (VITE_-prefixed). The browser reaches REST
// through the Vite /lcd proxy because the public API sends no CORS headers.
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";

// Testnet address of the builder (registered for the fest). Shown on the
// project page, as the fest requires.
const BUILDER_TESTNET_ADDRESS = "qor1d3schmtf6kaa4ppzt56822rc7rfyhjdfrdwec0";

const box: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "1rem",
  marginTop: "1.5rem",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

function short(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 12)}…${addr.slice(-8)}` : addr;
}

export function App(): JSX.Element {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Wallet
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [pqcRegistered, setPqcRegistered] = useState<boolean | null>(null);
  const [mockMode, setMockMode] = useState(false);

  // My seal keys / key card
  const [keyCardText, setKeyCardText] = useState("");

  // Create a will
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientCard, setRecipientCard] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [sealed, setSealed] = useState<SealedWill | null>(null);
  const [sealMemo, setSealMemo] = useState("");
  const [txHash, setTxHash] = useState("");

  // Open a will
  const [openEnvelope, setOpenEnvelope] = useState("");
  const [openTxHash, setOpenTxHash] = useState("");
  const [openRecipient, setOpenRecipient] = useState("");
  const [openReleaseUnix, setOpenReleaseUnix] = useState("");
  const [openedMessage, setOpenedMessage] = useState("");
  const [anchorReport, setAnchorReport] = useState<string[]>([]);

  // Dev-only mock wallet (?mock-qorex=1) + deep link #/open?e=...&tx=...
  useEffect(() => {
    void maybeInstallQorexMock().then((installed) => {
      if (installed) setMockMode(true);
    });
    const hash = window.location.hash;
    if (hash.startsWith("#/open?")) {
      const params = new URLSearchParams(hash.slice("#/open?".length));
      const e = params.get("e");
      const tx = params.get("tx");
      if (e) setOpenEnvelope(e);
      if (tx) setOpenTxHash(tx);
    }
  }, []);

  function fail(err: unknown): void {
    setError(err instanceof Error ? err.message : String(err));
  }

  async function onConnect(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { address: addr } = await connectQorexWallet();
      setAddress(addr);
      setMockMode(isMockQorex());
      // @qorechain/sdk is heavy: load it only when the user connects.
      const { createClient } = await import("@qorechain/sdk");
      const client = createClient({
        network: "testnet",
        endpoints: { rest: REST_URL, evmRpc: "https://evm-testnet.qore.host" },
      });
      const res = await client.rest.getAllBalances(addr);
      const qor = (res.balances as { denom: string; amount: string }[]).find(
        (b) => b.denom === "uqor",
      );
      setBalance(qor ? `${Number(qor.amount) / 1_000_000} QOR` : "0 QOR");
      const pqc = await getPqcStatus(REST_URL, addr);
      setPqcRegistered(pqc.found);
      setNotice(
        pqc.found
          ? "QoreX connected. This account's ML-DSA-87 key is registered."
          : "QoreX connected. The ML-DSA-87 key is not registered yet — QoreX will register it automatically on your first transaction.",
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onShowKeyCard(): Promise<void> {
    setError(null);
    try {
      const keys = await getOrCreateSealKeys();
      setKeyCardText(keyCardToText(await exportKeyCard(keys, address || undefined)));
      setNotice(
        "Seal keys are created/stored ONLY in this browser (localStorage). " +
          "Share only the key card below — never share your seed/recovery phrase.",
      );
    } catch (err) {
      fail(err);
    }
  }

  async function onSeal(): Promise<void> {
    setError(null);
    setNotice(null);
    setSealed(null);
    setSealMemo("");
    setTxHash("");
    try {
      if (!message.trim()) throw new Error("Write your final message first.");
      if (!recipient.trim().startsWith("qor1")) {
        throw new Error("The recipient address must be qor1… (testnet).");
      }
      if (!recipientCard.trim()) {
        throw new Error("Paste the recipient's key card (from section 2 in the recipient's browser).");
      }
      const releaseUnix = Math.floor(new Date(releaseDate).getTime() / 1000);
      if (!Number.isFinite(releaseUnix) || releaseUnix <= Date.now() / 1000) {
        throw new Error("Pick a release date in the future.");
      }
      const recipientKeys = await parseKeyCard(recipientCard);
      const result = await sealWillMessage(message.trim(), recipientKeys);
      setSealed(result);
      setSealMemo(buildSealMemo(result.envelopeHash, releaseUnix));
      setOpenRecipient(recipient.trim());
      setOpenReleaseUnix(String(releaseUnix));
      setOpenEnvelope(result.envelopeText);
      setNotice(
        "Message sealed (offline, ML-KEM-1024 + X25519). " +
          "Next step: send the seal on-chain so its hash is recorded.",
      );
    } catch (err) {
      fail(err);
    }
  }

  async function onSendSeal(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!sealed || !sealMemo) {
      setError("Seal the message first (step 1).");
      return;
    }
    if (!address) {
      setError("Connect QoreX first (section 1).");
      return;
    }
    setBusy(true);
    try {
      const res = await sendSealTx({ from: address, to: recipient.trim(), memo: sealMemo });
      setTxHash(res.txHash);
      setOpenTxHash(res.txHash);
      setNotice(
        `Seal sent! Tx ${res.txHash} (code ${res.code}). ` +
          "Share the open link below with the recipient.",
      );
    } catch (err) {
      if (isUserRejection(err)) {
        setError("You cancelled the approval in QoreX. The seal was not sent.");
      } else {
        fail(err);
      }
    } finally {
      setBusy(false);
    }
  }

  function shareLink(): string {
    if (!sealed) return "";
    const params = new URLSearchParams({ e: sealed.envelopeText });
    if (txHash) params.set("tx", txHash);
    return `${window.location.origin}${window.location.pathname}#/open?${params.toString()}`;
  }

  async function onVerifyAndOpen(): Promise<void> {
    setError(null);
    setNotice(null);
    setOpenedMessage("");
    setAnchorReport([]);
    try {
      if (!openEnvelope.trim()) throw new Error("Paste the envelope (qoreseal:… text) first.");
      if (!openTxHash.trim()) throw new Error("Enter the seal transaction hash.");
      if (!openRecipient.trim().startsWith("qor1")) {
        throw new Error("The recipient address must be qor1… .");
      }
      const releaseUnix = Number(openReleaseUnix);
      if (!Number.isInteger(releaseUnix) || releaseUnix <= 0) {
        throw new Error("Invalid release date (unix).");
      }
      // The anchor check needs the hash of the envelope BYTES, so decode the
      // pasted text first — never hash the text itself.
      const realHash = await hashEnvelopeTextHex(openEnvelope.trim());
      const check = await verifySealAnchor(REST_URL, {
        txHash: openTxHash.trim(),
        envelopeHash: realHash,
        recipient: openRecipient.trim(),
        releaseUnix,
      });
      setAnchorReport(check.reasons);
      if (!check.ok) {
        setError("Seal verification failed — see the report below. The message was NOT opened.");
        return;
      }
      const keys = await getOrCreateSealKeys();
      const text = await openWillEnvelope(openEnvelope, keys);
      setOpenedMessage(text);
      setNotice("Seal verified and message opened.");
    } catch (err) {
      fail(err);
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "2rem auto",
        padding: "0 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1>Q-Will — Quantum-Resistant Digital Will</h1>
      <p style={{ color: "#555" }}>
        Write a final message, seal it with QoreSeal (ML-KEM-1024), and anchor the seal on the
        QoreChain testnet ({QWILL_CHAIN_ID}) with ONE hybrid-signed transaction. The recipient
        opens it after the release date — and only the recipient can open it.
      </p>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        Network: testnet · Builder (testnet address):{" "}
        <code>{short(BUILDER_TESTNET_ADDRESS)}</code>
      </p>
      {mockMode && (
        <p style={{ color: "#8a6d00", background: "#fff8d6", padding: "0.5rem" }}>
          Mock QoreX mode (dev): the connection can be tested, but sending transactions
          is disabled on this VM.
        </p>
      )}
      {notice && <p style={{ color: "#0a7a2f" }}>{notice}</p>}
      {error && (
        <p style={{ color: "#b00020" }} role="alert">
          {error}
        </p>
      )}

      <section style={box}>
        <h2>1. Connect QoreX</h2>
        <p>
          {address ? (
            <>
              Connected: <code>{short(address)}</code> · Balance: {balance ?? "…"} · ML-DSA-87
              key:{" "}
              {pqcRegistered === null ? "…" : pqcRegistered ? "registered" : "not registered"}
            </>
          ) : (
            "Not connected yet. Open this page in the QoreX in-app browser, or use the QoreX extension (Testnet)."
          )}
        </p>
        <button onClick={() => void onConnect()} disabled={busy}>
          {address ? "Reconnect" : "Connect QoreX"}
        </button>
        {!isQorexAvailable() && !mockMode && (
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            QoreX was not detected in this browser. On desktop without the extension, run dev
            with <code>?mock-qorex=1</code> to test the connection UI (mock).
          </p>
        )}
      </section>

      <section style={box}>
        <h2>2. My seal keys (for recipients)</h2>
        <p style={{ fontSize: "0.9rem", color: "#555" }}>
          Seal keys are created and stored ONLY in this browser (localStorage). Others
          only need the key card (public key) to send you a sealed message. Never
          share your seed/recovery phrase with anyone — this app never
          asks for it.
        </p>
        <button onClick={() => void onShowKeyCard()}>Create / show my key card</button>
        {keyCardText && (
          <textarea
            readOnly
            value={keyCardText}
            rows={4}
            style={{ ...input, marginTop: "0.5rem" }}
            aria-label="My key card"
          />
        )}
        {hasLocalSealKeys() && !keyCardText && (
          <p style={{ fontSize: "0.9rem" }}>This browser already has seal keys.</p>
        )}
      </section>

      <section style={box}>
        <h2>3. Create a will</h2>
        <label>
          Final message
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            style={input}
            placeholder="Write a message for the recipient…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Recipient address (qor1…)
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={input}
            placeholder="qor1…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Recipient key card (from section 2 in the recipient's browser)
          <textarea
            value={recipientCard}
            onChange={(e) => setRecipientCard(e.target.value)}
            rows={3}
            style={input}
            placeholder='{"v":1,"kind":"qwill-key-card",…}'
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Release date
          <input
            type="datetime-local"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            style={input}
          />
        </label>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={() => void onSeal()}>1. Seal message (offline)</button>
          <button onClick={() => void onSendSeal()} disabled={busy || !sealed}>
            2. Send seal on-chain (QoreX)
          </button>
        </div>
        {sealed && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
            <p>
              Envelope: {sealed.envelope.length} bytes · hash:{" "}
              <code>{sealed.envelopeHash.slice(0, 16)}…</code>
            </p>
            <p>
              Seal memo ({sealMemo.length} bytes, max 256): <code>{sealMemo}</code>
            </p>
            <p>
              Send value: {Number(QWILL_SEAL_AMOUNT_UQOR) / 1_000_000} QOR (symbolic).
            </p>
            {txHash && (
              <>
                <p>
                  Seal tx: <code>{txHash}</code>
                </p>
                <p>
                  Open link for the recipient:
                  <br />
                  <code style={{ wordBreak: "break-all" }}>{shareLink()}</code>
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <section style={box}>
        <h2>4. Open a will (recipient)</h2>
        <p style={{ fontSize: "0.9rem", color: "#555" }}>
          Paste the envelope from the link, enter the seal transaction hash, then verify. The message
          only opens when the seal is verified on-chain AND the release date has passed
          AND this browser holds the recipient's seal keys.
        </p>
        <label>
          Envelope (qoreseal:… text)
          <textarea
            value={openEnvelope}
            onChange={(e) => setOpenEnvelope(e.target.value)}
            rows={3}
            style={input}
            placeholder="qoreseal:…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Seal transaction hash
          <input
            value={openTxHash}
            onChange={(e) => setOpenTxHash(e.target.value)}
            style={input}
            placeholder="hex tx hash"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Recipient address (qor1…)
          <input
            value={openRecipient}
            onChange={(e) => setOpenRecipient(e.target.value)}
            style={input}
            placeholder="qor1…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Release date (unix seconds)
          <input
            value={openReleaseUnix}
            onChange={(e) => setOpenReleaseUnix(e.target.value)}
            style={input}
            placeholder="e.g. 1796000000"
          />
        </label>
        <button onClick={() => void onVerifyAndOpen()} style={{ marginTop: "0.75rem" }}>
          Verify &amp; open
        </button>
        {anchorReport.length > 0 && (
          <ul style={{ fontSize: "0.9rem" }}>
            {anchorReport.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {openedMessage && (
          <blockquote
            style={{
              borderLeft: "4px solid #0a7a2f",
              margin: "1rem 0 0",
              padding: "0.5rem 1rem",
              background: "#f2fbf5",
            }}
          >
            {openedMessage}
          </blockquote>
        )}
      </section>
    </main>
  );
}
