# Q-Will — Surat Wasiat Digital Tahan Kuantum

**QoreChain Developer Fest "Build Before Q-Day" — Quantum Pass.**

Tulis pesan terakhir, segel dengan QoreSeal (ML-KEM-1024, FIPS 203), dan catat
segelnya di QoreChain testnet lewat **satu transaksi hybrid-signed**
(secp256k1 + ML-DSA-87). Penerima membukanya setelah tanggal rilis — dan hanya
penerima yang bisa membukanya.

- **Testnet:** `qorechain-diana` (EVM 9800)
- **Alamat testnet pembuat:** `qor1d3schmtf6kaa4ppzt56822rc7rfyhjdfrdwec0`
  (`0x6c618bed69d5bbda84225d34752878f0d24bc9a9`)
- **Builder:** Robert Amsterdam — GitHub
  [ExJoyz](https://github.com/ExJoyz) · X
  [@araggoorn](https://x.com/araggoorn)
- **Lisensi:** MIT
- **AI usage:** lihat [`AI_USAGE.md`](AI_USAGE.md) — build ini dikerjakan
  dengan bantuan AI (Best AI-Native Build).

## Kenapa ini penting (Q-Day)

Ancaman "harvest now, decrypt later": pesan terenkripsi klasik yang dipanen
hari ini bisa dibuka komputer kuantum nanti. Q-Will menyegel pesan dengan
ML-KEM-1024 — kunci pasca-kuantum — dan membuktikan segelnya di chain dengan
tanda tangan hybrid, jadi wasiatmu tetap rahasia sampai waktunya tiba, bahkan
setelah Q-Day.

## Cara kerja

1. **Penerima menyiapkan kunci segel** (bagian 2 di aplikasi): kunci dibuat dan
   disimpan HANYA di browser penerima (localStorage). Yang dibagikan hanya
   *key card* (kunci publik). Aplikasi tidak pernah meminta seed phrase.
2. **Pengirim menyegel pesan** (bagian 3): pesan dienkripsi offline dengan
   `@qorechain/qoreseal` ke key card penerima. Amplop (~1,8 KB) TIDAK masuk
   chain — memo transaksi maksimal 256 karakter.
3. **Pengirim mengirim segel ke chain**: satu native bank send 0,001 QOR ke
   penerima, memo `QWILL1:<sha3-256(amplop) hex>:<tanggal rilis unix>`.
   QoreX menandatangani transaksi ini secara hybrid (secp256k1 + ML-DSA-87) —
   inilah **satu transaksi hybrid-signed** yang disyaratkan Quantum Pass.
4. **Penerima membuka** (bagian 4, setelah tanggal rilis): aplikasi mengambil
   transaksi BERDASARKAN HASH (`GET /cosmos/tx/v1beta1/txs/{hash}`), memeriksa
   memo cocok dengan hash amplop + penerima + tanggal rilis, lalu mendekripsi
   amplop dengan kunci segel lokal penerima.

## Arsitektur

```
Browser (Vite + React + TypeScript)
├── src/lib/qwill.ts   — seal/open QoreSeal, memo segel, verifikasi anchor
├── src/lib/qorex.ts   — connect QoreX, kirim segel via signAndBroadcast
├── src/lib/qorex-mock.ts — mock QoreX (dev only, ?mock-qorex=1)
└── src/App.tsx        — UI: hubungkan / kunci segel / buat / buka

Chain (testnet qorechain-diana)
└── bank send 0,001 QOR + memo QWILL1:… (satu-satunya tulisan on-chain)
```

Tidak ada smart contract: segel adalah transaksi native + memo. Tidak ada
server: amplop berjalan lewat tautan (`#/open?e=…&tx=…`), hash-nya terikat di
memo on-chain.

## Cara menjalankan

```sh
npm install
npm run dev    # http://localhost:5173
```

| Variabel | Tujuan | Nilai |
| -------- | ------ | ----- |
| `VITE_QORE_REST_URL` | REST native | `/lcd` (proxy dev server) |
| `QORE_REST_PROXY_TARGET` | Tujuan `/lcd` | `https://api-testnet.qore.host` |
| `VITE_QORE_EVM_RPC_URL` | EVM JSON-RPC | `https://evm-testnet.qore.host` |

REST publik tidak mengirim header CORS, jadi browser memakai proxy Vite
(`/lcd`, lihat `vite.config.ts`). Untuk production, serve aplikasi di balik
proxy yang meneruskan `/lcd` dengan cara yang sama.

## Cara menguji dari HP (QoreX asli)

1. Deploy aplikasi ini (atau jalankan `npm run dev` lalu buka dari HP dalam
   satu jaringan), atau buka URL deploy-nya di **browser dalam aplikasi
   QoreX** (atau Chrome dengan ekstensi QoreX, Testnet).
2. Isi test QOR dari faucet https://dashboard.qorechain.io/faucet bila saldo
   kurang (biaya segel ~0,001 QOR + fee).
3. Bagian 1: hubungkan QoreX. Bagian 2: buat key card (di browser penerima).
4. Bagian 3: tulis pesan, tempel alamat + key card penerima, pilih tanggal
   rilis, klik "Segel pesan", lalu "Kirim segel ke chain" dan **setujui di
   QoreX**.
5. Bagikan tautan buka kepada penerima. Setelah tanggal rilis, penerima
   membuka tautan, aplikasi memverifikasi segel di chain, lalu pesan terbuka.

Mode mock (`?mock-qorex=1`, dev only) memakai wallet mock resmi
(`@qorechain/qorex-wallet-mock`) untuk menguji tampilan koneksi di desktop —
**pengiriman transaksi dinonaktifkan dalam mode mock**; uji kirim hanya dari
HP dengan QoreX asli.

## Cara memverifikasi transaksi hybrid-signed

1. Ambil hash transaksi segel dari aplikasi (bagian 3).
2. Baca transaksinya:
   `GET https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<hash>`
   (atau lewat proxy aplikasi: `/lcd/cosmos/tx/v1beta1/txs/<hash>`).
3. Periksa: `tx_response.code == 0`, `tx.body.memo` berbentuk
   `QWILL1:<sha3-256 hex>:<unix>`, dan pesan `MsgSend` ke alamat penerima.
4. Periksa lapisan pasca-kuantum: transaksi membawa ekstensi tanda tangan
   hybrid (ML-DSA-87) untuk kunci yang terdaftar di
   `GET /qorechain/pqc/v1/account/<alamat>`.

## Spike QoreSeal — verdict jujur (20 Nov 2026)

Rencana awal: enkripsi ke alamat qor1 mana pun lewat *registry* KEM on-chain,
lalu dekripsi "di dalam QoreX". **Rencana itu TERBLOKIR pada dua hal**,
dibuktikan langsung (skrip: `npm run spike`, `scripts/spike-qoreseal.mjs`):

1. **Registry KEM butuh kunci yang sudah dipublikasikan.** Alamat pembuat
   sendiri belum punya KEM key (`GET /qorechain/pqc/v1/kem/<alamat>` →
   `{"found":false}`), dan `sealToAddresses` ke alamat itu gagal dengan
   `KEM_KEY_NOT_REGISTERED`. Lebih penting: **QoreX menolak**
   `MsgRegisterKEMKey`/`MsgRemoveKEMKey` dari dApp
   (`QOREX_REFUSED_TYPE_URLS` di `@qorechain/wallet-adapter`) — dApp tidak
   bisa mendaftarkan KEM key penerima lewat QoreX. Jadi alur "segel ke alamat
   mana pun" tidak bisa jalan dari dApp.
2. **Tidak ada API dekripsi QoreX untuk dApp.** Dokumentasi dan paket QoreX
   (`@qorechain/wallet-adapter`, `@qorechain/qorex-types`) hanya mengekspos
   `signAndBroadcast` (+ EVM/SVM). "Dekripsi di dalam QoreX" bukan alur yang
   didukung.

**Yang BERHASIL dan dipakai (desain SealedDrop, arsitektur 80% sama):**

- Round-trip QoreSeal offline (ML-KEM-1024 + X25519 hybrid) berhasil:
  amplop 1.781 byte untuk pesan ~60 karakter, teks `qoreseal:…` 2.384 karakter.
- Kunci salah ditolak (`NOT_A_RECIPIENT`), purpose salah ditolak
  (`DECRYPTION_FAILED`), kunci derivatif dari seed deterministik.
- Kunci segel dibuat di browser penerima (localStorage) dan hanya kunci
  publiknya yang dibagikan — enkripsi tetap ML-KEM-1024 asli, dan segel tetap
  dijangkar on-chain oleh satu transaksi hybrid-signed. Kekurangan yang diakui
  di sini: kunci hilang bila data browser dihapus; produksi butuh dekripsi
  native di wallet.

## Jebakan testnet yang sudah ditangani

- **Riwayat tx 500:** `GET /cosmos/tx/v1beta1/txs?events=…` menjawab HTTP 500.
  Aplikasi TIDAK PERNAH membaca riwayat — verifikasi memakai baca transaksi
  per hash (terbukti menjawab 404 untuk hash yang tidak ada, bukan 500).
- **REST tanpa CORS:** browser memakai proxy Vite `/lcd` (sudah ada di
  template `fullstack-web`); `QORE_REST_PROXY_TARGET` di `.env` mengarah ke
  testnet.
- **Memo 256 byte:** `max_memo_characters: 256` (chain) dan
  `QOREX_MAX_MEMO_BYTES: 256`. Memo segel hanya berisi hash + tanggal rilis
  (~83 karakter); amplop tidak pernah masuk memo.
- **QoreX menolak pesan manajemen kunci PQC** — lihat spike di atas.

## Build / type-check

```sh
npm run typecheck   # tsc --noEmit
npm run build       # type-check + vite build
npm run spike       # spike QoreSeal (node, tanpa wallet/transaksi)
```

## Status

Fondasi (20 Nov 2026): scaffold + koneksi QoreX + alur segel + spike selesai.
Belum ada transaksi yang dikirim dari VM ini — pengiriman pertama dilakukan
dari HP dengan QoreX asli. Belum ada repo GitHub (GitHub CLI belum login di
VM); repo publik `ExJoyz/q-will` dibuat saat login tersedia.
