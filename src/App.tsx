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
          ? "QoreX terhubung. Kunci ML-DSA-87 akun ini sudah terdaftar."
          : "QoreX terhubung. Kunci ML-DSA-87 belum terdaftar — QoreX akan mendaftarkannya otomatis di transaksi pertamamu.",
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
        "Kunci segel dibuat/disimpan HANYA di browser ini (localStorage). " +
          "Bagikan hanya key card di bawah — jangan pernah membagikan seed/fraza.",
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
      if (!message.trim()) throw new Error("Tulis dulu pesan terakhirnya.");
      if (!recipient.trim().startsWith("qor1")) {
        throw new Error("Alamat penerima harus qor1… (testnet).");
      }
      if (!recipientCard.trim()) {
        throw new Error("Tempel key card penerima (didapat dari bagian 2 di browser penerima).");
      }
      const releaseUnix = Math.floor(new Date(releaseDate).getTime() / 1000);
      if (!Number.isFinite(releaseUnix) || releaseUnix <= Date.now() / 1000) {
        throw new Error("Pilih tanggal rilis di masa depan.");
      }
      const recipientKeys = await parseKeyCard(recipientCard);
      const result = await sealWillMessage(message.trim(), recipientKeys);
      setSealed(result);
      setSealMemo(buildSealMemo(result.envelopeHash, releaseUnix));
      setOpenRecipient(recipient.trim());
      setOpenReleaseUnix(String(releaseUnix));
      setOpenEnvelope(result.envelopeText);
      setNotice(
        "Pesan tersegel (offline, ML-KEM-1024 + X25519). " +
          "Langkah berikut: kirim segel ke chain agar hash-nya tercatat.",
      );
    } catch (err) {
      fail(err);
    }
  }

  async function onSendSeal(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!sealed || !sealMemo) {
      setError("Segel dulu pesannya (langkah 1).");
      return;
    }
    if (!address) {
      setError("Hubungkan QoreX dulu (bagian 1).");
      return;
    }
    setBusy(true);
    try {
      const res = await sendSealTx({ from: address, to: recipient.trim(), memo: sealMemo });
      setTxHash(res.txHash);
      setOpenTxHash(res.txHash);
      setNotice(
        `Segel terkirim! Tx ${res.txHash} (code ${res.code}). ` +
          "Bagikan tautan buka di bawah kepada penerima.",
      );
    } catch (err) {
      if (isUserRejection(err)) {
        setError("Kamu membatalkan persetujuan di QoreX. Segel belum terkirim.");
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
      if (!openEnvelope.trim()) throw new Error("Tempel amplop (teks qoreseal:…) dulu.");
      if (!openTxHash.trim()) throw new Error("Masukkan hash transaksi segel.");
      if (!openRecipient.trim().startsWith("qor1")) {
        throw new Error("Alamat penerima harus qor1… .");
      }
      const releaseUnix = Number(openReleaseUnix);
      if (!Number.isInteger(releaseUnix) || releaseUnix <= 0) {
        throw new Error("Tanggal rilis (unix) tidak valid.");
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
        setError("Verifikasi segel gagal — lihat laporan di bawah. Pesan TIDAK dibuka.");
        return;
      }
      const keys = await getOrCreateSealKeys();
      const text = await openWillEnvelope(openEnvelope, keys);
      setOpenedMessage(text);
      setNotice("Segel terverifikasi dan pesan dibuka.");
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
      <h1>Q-Will — Surat Wasiat Digital Tahan Kuantum</h1>
      <p style={{ color: "#555" }}>
        Tulis pesan terakhir, segel dengan QoreSeal (ML-KEM-1024), dan catat segelnya di
        QoreChain testnet ({QWILL_CHAIN_ID}) lewat SATU transaksi hybrid-signed. Penerima
        membukanya setelah tanggal rilis — dan hanya penerima yang bisa membukanya.
      </p>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        Jaringan: testnet · Pembuat (alamat testnet):{" "}
        <code>{short(BUILDER_TESTNET_ADDRESS)}</code>
      </p>
      {mockMode && (
        <p style={{ color: "#8a6d00", background: "#fff8d6", padding: "0.5rem" }}>
          Mode mock QoreX (dev): koneksi bisa diuji, tapi pengiriman transaksi
          dinonaktifkan di VM ini.
        </p>
      )}
      {notice && <p style={{ color: "#0a7a2f" }}>{notice}</p>}
      {error && (
        <p style={{ color: "#b00020" }} role="alert">
          {error}
        </p>
      )}

      <section style={box}>
        <h2>1. Hubungkan QoreX</h2>
        <p>
          {address ? (
            <>
              Terhubung: <code>{short(address)}</code> · Saldo: {balance ?? "…"} · Kunci
              ML-DSA-87:{" "}
              {pqcRegistered === null ? "…" : pqcRegistered ? "terdaftar" : "belum terdaftar"}
            </>
          ) : (
            "Belum terhubung. Buka halaman ini di browser dalam aplikasi QoreX, atau pakai ekstensi QoreX (Testnet)."
          )}
        </p>
        <button onClick={() => void onConnect()} disabled={busy}>
          {address ? "Hubungkan ulang" : "Hubungkan QoreX"}
        </button>
        {!isQorexAvailable() && !mockMode && (
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            QoreX tidak terdeteksi di browser ini. Di desktop tanpa ekstensi, jalankan dev
            dengan <code>?mock-qorex=1</code> untuk menguji tampilan koneksi (mock).
          </p>
        )}
      </section>

      <section style={box}>
        <h2>2. Kunci segel saya (untuk penerima)</h2>
        <p style={{ fontSize: "0.9rem", color: "#555" }}>
          Kunci segel dibuat dan disimpan HANYA di browser ini (localStorage). Pihak lain
          hanya butuh key card (kunci publik) untuk mengirimi kamu pesan tersegel. Jangan
          pernah membagikan seed/fraza pemulihan ke siapa pun — aplikasi ini tidak pernah
          memintanya.
        </p>
        <button onClick={() => void onShowKeyCard()}>Buat / tampilkan key card saya</button>
        {keyCardText && (
          <textarea
            readOnly
            value={keyCardText}
            rows={4}
            style={{ ...input, marginTop: "0.5rem" }}
            aria-label="Key card saya"
          />
        )}
        {hasLocalSealKeys() && !keyCardText && (
          <p style={{ fontSize: "0.9rem" }}>Browser ini sudah punya kunci segel.</p>
        )}
      </section>

      <section style={box}>
        <h2>3. Buat surat wasiat</h2>
        <label>
          Pesan terakhir
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            style={input}
            placeholder="Tulis pesan untuk penerima…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Alamat penerima (qor1…)
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={input}
            placeholder="qor1…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Key card penerima (dari bagian 2 di browser penerima)
          <textarea
            value={recipientCard}
            onChange={(e) => setRecipientCard(e.target.value)}
            rows={3}
            style={input}
            placeholder='{"v":1,"kind":"qwill-key-card",…}'
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Tanggal rilis
          <input
            type="datetime-local"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            style={input}
          />
        </label>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={() => void onSeal()}>1. Segel pesan (offline)</button>
          <button onClick={() => void onSendSeal()} disabled={busy || !sealed}>
            2. Kirim segel ke chain (QoreX)
          </button>
        </div>
        {sealed && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
            <p>
              Amplop: {sealed.envelope.length} byte · hash:{" "}
              <code>{sealed.envelopeHash.slice(0, 16)}…</code>
            </p>
            <p>
              Memo segel ({sealMemo.length} byte, maks 256): <code>{sealMemo}</code>
            </p>
            <p>
              Nilai kirim: {Number(QWILL_SEAL_AMOUNT_UQOR) / 1_000_000} QOR (simbolis).
            </p>
            {txHash && (
              <>
                <p>
                  Tx segel: <code>{txHash}</code>
                </p>
                <p>
                  Tautan buka untuk penerima:
                  <br />
                  <code style={{ wordBreak: "break-all" }}>{shareLink()}</code>
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <section style={box}>
        <h2>4. Buka surat (penerima)</h2>
        <p style={{ fontSize: "0.9rem", color: "#555" }}>
          Tempel amplop dari tautan, masukkan hash transaksi segel, lalu verifikasi. Pesan
          hanya terbuka bila segel terverifikasi di chain DAN tanggal rilis sudah lewat
          DAN browser ini memegang kunci segel penerima.
        </p>
        <label>
          Amplop (teks qoreseal:…)
          <textarea
            value={openEnvelope}
            onChange={(e) => setOpenEnvelope(e.target.value)}
            rows={3}
            style={input}
            placeholder="qoreseal:…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Hash transaksi segel
          <input
            value={openTxHash}
            onChange={(e) => setOpenTxHash(e.target.value)}
            style={input}
            placeholder="hex tx hash"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Alamat penerima (qor1…)
          <input
            value={openRecipient}
            onChange={(e) => setOpenRecipient(e.target.value)}
            style={input}
            placeholder="qor1…"
          />
        </label>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          Tanggal rilis (unix detik)
          <input
            value={openReleaseUnix}
            onChange={(e) => setOpenReleaseUnix(e.target.value)}
            style={input}
            placeholder="mis. 1796000000"
          />
        </label>
        <button onClick={() => void onVerifyAndOpen()} style={{ marginTop: "0.75rem" }}>
          Verifikasi &amp; buka
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
