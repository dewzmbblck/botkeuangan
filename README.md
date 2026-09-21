# Fonnte Finance Bot — Multi Rekening

Bot WhatsApp untuk mencatat mutasi di beberapa rekening (rekening sendiri +
rekening pihak luar/peminjam), termasuk hutang-piutang, dan menghitung
**Total Aset Asli** secara otomatis.

Struktur project:

```
fonnte-finance-bot/
├── api/
│   └── webhook.js       # endpoint yang dipanggil Fonnte tiap ada pesan masuk
├── lib/
│   ├── parser.js         # ubah teks bebas jadi data transaksi
│   ├── accounts.js        # load/cari/update saldo rekening di sheet Master
│   ├── sheets.js           # tulis baris ke sheet Log
│   └── fonnte.js            # kirim balasan WhatsApp
├── package.json
├── .env.example
└── README.md
```

---

## 1. Siapkan Google Sheet

Buat satu spreadsheet baru berisi **3 sheet/tab**: `Master`, `Log`, dan `Dashboard`.

### Tab "Master" (baris 1 = header, isi mulai baris 2)

| ID | Bank | Pemilik | Kategori | SaldoRiil | Alias | Keterangan |
|---|---|---|---|---|---|---|
| ACC-01 | BCA | Saya Sendiri | Sendiri | 5000000 | bca-saya | Rekening pribadi utama |
| ACC-02 | Mandiri | Saya Sendiri | Sendiri | 3000000 | mandiri-saya | Rekening pribadi kedua |
| ACC-03 | Jago | Saya Sendiri | Sendiri | 1000000 | jago-saya | Rekening pribadi ketiga |
| ACC-04 | BCA | Peminjam A | PihakLuar | 500000 | bca-a | Rekening tempat memberi pinjaman |
| ACC-05 | BRI | Peminjam B | PihakLuar | 0 | bri-b | Rekening tempat memberi pinjaman |
| ACC-06 | Mandiri | Peminjam C | PihakLuar | 0 | mandiri-c | Rekening tempat memberi pinjaman |

Catatan kolom:
- **Kategori** wajib diisi persis `Sendiri` atau `PihakLuar` (tanpa spasi), dipakai bot untuk menghitung dashboard.
- **SaldoRiil** diisi saldo awal saat pertama kali setup — setelahnya kolom ini di-update otomatis oleh bot setiap ada transaksi.
- **Alias** kata kunci pendek unik untuk memanggil rekening ini lewat chat (opsional, tapi disarankan karena beberapa rekening bisa punya nama bank sama, misalnya dua akun Mandiri).

### Tab "Log" (baris 1 = header, bot yang isi otomatis mulai baris 2)

| Tanggal | Jenis | RekeningAsal | RekeningTujuan | Nominal | StatusResmi | Via | Notes | Pengirim |
|---|---|---|---|---|---|---|---|---|

Kosongkan saja — bot akan menambah baris baru di sini setiap ada transaksi, sebagai jejak audit lengkap.

### Tab "Dashboard"

Kosongkan juga — bot yang menulis isinya otomatis setiap ada transaksi yang mengubah saldo. Hasilnya berupa tabel breakdown **per rekening** ditambah baris total di bawahnya:

| ID | Bank | Pemilik | Kategori | Saldo Riil / Kontribusi Aset |
|---|---|---|---|---|
| ACC-01 | BCA | Saya Sendiri | Sendiri | 5000000 |
| ACC-02 | Mandiri | Saya Sendiri | Sendiri | 3000000 |
| ... | | | | |
| | | | **Total Saldo Rekening Sendiri** | 9000000 |
| | | | **Total Piutang Aktif** | 500000 |
| | | | **Total Aset Asli** | 9500000 |

Karena ini tab sheet biasa, kamu bisa buka kapan saja tanpa perlu chat ke bot — datanya selalu sinkron karena ditulis ulang otomatis setiap kali ada transaksi `masuk`, `keluar`, `hutang`, atau `bayar`, dan juga ikut disegarkan setiap kamu ketik `saldo`/`rekap`.

Ambil **Sheet ID** dari URL: `https://docs.google.com/spreadsheets/d/INI_SHEET_ID_NYA/edit`.

## 2. Buat Service Account Google

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat/pilih project.
2. Aktifkan **Google Sheets API** (*APIs & Services* → *Enable APIs and Services*).
3. *APIs & Services* → *Credentials* → *Create Credentials* → **Service Account**.
4. Di tab **Keys** service account tsb → *Add Key* → *Create new key* → **JSON** → download filenya (rahasia, jangan dibagikan).
5. Catat dari file JSON: `client_email` dan `private_key`.
6. Buka Google Sheet dari langkah 1 → *Share* → tambahkan `client_email` tadi sebagai **Editor**. Tanpa ini bot tidak bisa baca/tulis sheet.

## 3. Siapkan device Fonnte

1. Login ke [fonnte.com](https://fonnte.com) → menu **Device** → tambah device → scan QR.
2. Salin **Token** dari device list.
3. Biarkan kolom Webhook URL kosong dulu, diisi setelah deploy (langkah 5).

## 4. Deploy ke Vercel

1. Push folder project ke repo GitHub.
2. [vercel.com](https://vercel.com) → login GitHub → **Add New Project** → pilih repo → Deploy.
3. **Settings → Environment Variables**, tambahkan:
   - `FONNTE_TOKEN`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
4. Redeploy supaya env variable terbaca.
5. Endpoint webhook aktif di: `https://nama-project-kamu.vercel.app/api/webhook`

## 5. Sambungkan webhook ke Fonnte

Dashboard Fonnte → device kamu → isi **Webhook URL** dengan URL dari langkah 4.5.

---

## Format perintah WhatsApp

| Perintah | Contoh | Efek |
|---|---|---|
| `masuk <rekening> <nominal> <ket>` | `masuk ACC-01 500000 gaji` | SaldoRiil rekening tsb bertambah |
| `keluar <rekening> <nominal> <ket>` | `keluar bca-saya 15000 makan siang` | SaldoRiil rekening tsb berkurang |
| `hutang <asal> <tujuan> <nominal> <resmi\|tidak resmi> <ket>` | `hutang ACC-01 ACC-04 500000 tidak resmi beli modal` | Asal berkurang, Tujuan (peminjam) bertambah. Total Aset Asli tetap. |
| `bayar <peminjam> <tujuan saya> <nominal> <resmi\|tidak resmi> <ket>` | `bayar ACC-04 ACC-01 200000 tidak resmi cicilan 1` | Peminjam berkurang, Tujuan kamu bertambah. Total Aset Asli tetap. |
| `saldo` / `rekap` | — | Ringkasan: Total Saldo Sendiri, Total Piutang Aktif, Total Aset Asli |
| `rekening` / `daftar rekening` | — | Daftar semua rekening beserta SaldoRiil masing-masing |

`<rekening>` bisa diisi dengan **ID** (`ACC-01`), **Alias** (`bca-saya`), atau **nama bank** kalau nama itu unik di daftar kamu. Kalau ada dua rekening dengan nama bank yang sama (misal dua "Mandiri"), bot akan minta kamu pakai ID atau Alias supaya tidak ambigu.

## Cara kerja Total Aset Asli

```
Total Saldo Rekening Sendiri = SUM(SaldoRiil, Kategori = "Sendiri")
Total Piutang Aktif          = SUM(SaldoRiil, Kategori = "PihakLuar")
Total Aset Asli              = Total Saldo Rekening Sendiri + Total Piutang Aktif
```

- **Uang Masuk / Keluar** murni mengubah Total Aset Asli (karena benar-benar ada uang masuk/keluar dari luar sistem).
- **Beri Hutang / Bayar Hutang** hanya memindahkan saldo antar rekening Sendiri ↔ PihakLuar — Total Aset Asli otomatis tetap sama, karena uang itu tetap "milikmu", cuma pindah bentuk dari kas jadi piutang atau sebaliknya.
- Status **Resmi / Tidak Resmi** murni label pencatatan di kolom `StatusResmi` pada Log — tidak memengaruhi perhitungan saldo maupun dashboard, tapi berguna buat kamu memfilter/mengelompokkan transaksi belakangan (misalnya pakai Filter View di Google Sheets).

---

## Menjalankan lokal (opsional)

```bash
npm install
npm install -g vercel
cp .env.example .env    # lalu isi nilainya
vercel dev
```

Untuk terima webhook dari internet ke lokal, jalankan `ngrok http 3000` di terminal lain dan daftarkan URL ngrok itu sementara di Fonnte selama development.

## Ide pengembangan lanjutan

- **Riwayat per rekening**: command `riwayat ACC-04` yang menampilkan beberapa transaksi terakhir dari sheet Log yang melibatkan rekening tsb.
- **Reminder piutang jatuh tempo**: tambahkan kolom `JatuhTempo` di Log khusus baris "Beri Hutang", lalu buat Vercel Cron Job yang mengecek dan mengirim reminder otomatis.
- **Multi-user**: kalau lebih dari satu nomor WhatsApp akan pakai bot ini, tambahkan validasi `sender` di awal `webhook.js` supaya hanya nomor tertentu yang boleh input transaksi.
