# Fonnte Finance Bot — Keuangan + Planner Bulanan + Todo

Bot WhatsApp untuk mencatat mutasi di beberapa rekening (rekening sendiri +
rekening pihak luar/peminjam), termasuk hutang-piutang, dan menghitung
**Total Aset Asli** secara otomatis.

Struktur project:

```
fonnte-finance-bot/
├── api/
│   ├── webhook.js       # router: keuangan / planner / todo (dipanggil Fonnte tiap pesan masuk)
│   └── cron-pagi.js      # pengingat pagi (dipanggil Vercel Cron)
├── lib/
│   ├── parser.js         # ubah teks bebas jadi data transaksi
│   ├── accounts.js        # load/cari/update saldo rekening di sheet Master
│   ├── sheets.js           # tulis baris ke sheet Log
│   ├── fonnte.js            # kirim balasan WhatsApp (+ hitung kuota)
│   ├── planner.js           # planner gaji bulanan
│   ├── todo.js               # todo Kerja/Kuliah/Lainnya
│   ├── ledger.js              # jembatan planner -> saldo rekening
│   ├── gsheets.js             # helper Sheets + auto-buat tab baru
│   ├── time.js                 # waktu WIB & parser tenggat
│   ├── kuota.js               # penghitung kuota Fonnte
│   ├── pagi.js                 # susun pesan pengingat pagi
│   └── help.js                 # menu bantuan
├── vercel.json            # jadwal cron
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
   - `OWNER_NUMBER` — nomor WhatsApp kamu (wajib, supaya orang lain tidak bisa memakai bot)
   - `CRON_SECRET` — string acak panjang, untuk mengamankan endpoint cron
   - `FONNTE_QUOTA` — opsional, default 1000
4. Redeploy supaya env variable terbaca.
5. Endpoint webhook aktif di: `https://botkeuangan-three.vercel.app/api/webhook`

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


---

# Planner Bulanan

Tab `PlannerTemplate`, `PlannerGaji`, `Planner`, `Todo`, dan `PesanKeluar` **dibuat otomatis** oleh bot saat pertama kali dipakai (tidak perlu dibuat manual).

## Alur sebulan

1. Sekali saja, isi template item bulanan (bisa lewat chat atau langsung di sheet `PlannerTemplate`):
   `plan item tambah Listrik 250000 bayar 10 dari bca-saya`
   `plan item tambah Tabungan 500000 pisah 25 dari bca-saya ke jago-saya`
2. Setiap gaji masuk: `gaji 2900000 bca-saya` → saldo BCA bertambah, Log tercatat, dan checklist bulan itu dibuat dari template (siklus otomatis tiap bulan baru).
3. Saat sudah bayar: `lunas listrik` → status Terbayar + tanggal, saldo rekening terpotong (kalau rekening terhubung).
4. Saat sudah memisahkan uang: `pisah tabungan` → status Terpisah + tanggal, uang dipindah antar rekening sendiri (kalau rekening asal & tujuan terhubung).
5. `plan` kapan saja untuk melihat checklist, total alokasi, dan sisa gaji bebas.

## Perintah

| Perintah | Efek |
|---|---|
| `gaji <nominal> [rekening]` | Catat gaji; tanpa rekening hanya masuk planner. Gaji kedua di bulan yang sama dijumlahkan. |
| `lunas <item\|no> [nominal] [dari <rek>]` | Tandai terbayar. `nominal` mengganti angka rencana kalau tagihan berbeda. |
| `pisah <item\|no> [nominal] [dari <rek> ke <rek>]` | Tandai terpisah + pindahkan uang. |
| `plan` | Checklist bulan ini |
| `sisa` (atau `plan sisa`, `estimasi`) | Estimasi sisa uang bulan ini, budget harian, dan proyeksi akhir bulan (lihat di bawah) |
| `plan batal <item\|no>` | Kembalikan ke Belum **dan membalik mutasi saldo** kalau tadi ada |
| `plan item` | Daftar template |
| `plan item tambah <nama> <nominal> <bayar\|pisah> [tgl] [dari <rek>] [ke <rek>]` | Tambah ke template (dan ke bulan berjalan) |
| `plan item hapus <nama>` | Nonaktifkan dari template (baris tidak dihapus) |

Item bisa disebut dengan nama (cukup sebagian, asal unik) atau nomor di checklist.

## Estimasi sisa uang

Ketik `sisa` kapan saja untuk melihat berapa uang bebas yang tersisa dari gaji:

```
Sisa rencana        = Gaji − Total alokasi
Estimasi sisa uang  = Sisa rencana − Pengeluaran bebas
Budget aman/minggu  = Estimasi sisa uang ÷ sisa minggu di bulan ini (jika sisa ≥ 7 hari)
Proyeksi akhir      = Estimasi sisa uang − (total pengeluaran ÷ hari berjalan × sisa hari)
```

- **Pengeluaran bebas** = transaksi `keluar` di Log (bukan dari planner) sejak tanggal gaji pertama bulan ini. Item planner yang dibayar lewat `lunas` sudah masuk alokasi, jadi tidak dihitung dua kali. `masuk`, `hutang`, `bayar`, dan `Transfer` tidak dianggap pengeluaran.
- **Bayar tagihan yang ada di planner dengan `lunas`, bukan `keluar`.** Kalau dicatat dengan `keluar`, nominalnya terhitung dua kali (di alokasi dan di pengeluaran bebas).
- Angka dibuat **per minggu**, bukan per hari, karena pengeluaran biasanya tidak terjadi setiap hari. Hari tanpa pengeluaran tetap dihitung sebagai nol di proyeksi.
- Rata-rata dan proyeksi akhir bulan baru muncul setelah 7 hari data, karena rata-rata dari beberapa hari pertama terlalu bias. Kalau sisa bulan kurang dari 7 hari, bot hanya menampilkan sisa uangnya.
- Kalau tren pengeluaran akan menghabiskan sisa uang sebelum akhir bulan, bot menyebut perkiraan tanggal habisnya.
- Sisa hari dihitung sampai akhir bulan kalender, bukan sampai gaji berikutnya.

Catatan perilaku:
- **Periode = bulan kalender (WIB) saat `gaji` diketik.** Gaji tanggal 25 Okt untuk anggaran November belum didukung; ketik `gaji` setelah tanggal 1 bulan berikutnya, atau tambah dukungan periode manual kalau dibutuhkan.
- Mutasi dari planner masuk ke tab **Log** dengan kolom `Via = Planner`. `lunas` tercatat sebagai *Uang Keluar*, `pisah` sebagai *Transfer* (antar rekening sendiri, tidak dihitung sebagai piutang), dan gaji sebagai *Uang Masuk*.
- Total Aset Asli: `lunas` menguranginya (uang benar-benar keluar); `pisah` tidak mengubahnya (hanya pindah rekening).
- Rekening di template boleh diisi alias/ID. Hanya rekening kategori `Sendiri` yang bisa dipakai planner.

---

# Todo

Kategori: **Kerja**, **Kuliah**, **Lainnya**. Tugas yang selesai atau dihapus **tidak dihapus dari sheet**, hanya diubah kolom `Status` (`Belum` / `Selesai` / `Dihapus`).

| Perintah | Efek |
|---|---|
| `todo` | Tugas hari ini + yang terlambat |
| `todo semua` / `todo kerja` / `todo kuliah` / `todo lain` | Semua tugas aktif / per kategori |
| `todo tambah <kerja\|kuliah\|lain> <tugas> \| <tenggat>` | Tambah. Tanpa tenggat = hari ini. |
| `todo selesai <id> [id ...]` | Tandai selesai (boleh beberapa ID) |
| `todo edit <id> <teks baru> \| <tenggat>` | Ubah teks dan/atau tenggat |
| `todo tunda <id> <tenggat>` | Jadwal ulang |
| `todo pindah <id> <kategori>` | Pindah kategori |
| `todo buka <id>` | Batalkan status selesai |
| `todo hapus <id>` | Sembunyikan (status Dihapus) |
| `todo riwayat` | 10 tugas terakhir yang selesai |

Tambah banyak tugas dalam **satu pesan** dengan menulis tiap tugas di baris baru (hemat kuota):

```
todo tambah kuliah
baca bab 3 | besok
kerjakan tugas statistik | 25/10
rangkum jurnal
```

Tenggat yang dikenali: `hari ini`, `besok`, `lusa`, `senin`…`minggu`, `minggu depan`, `+3`, `25/10`, `25-10-2026`, `25 okt`, `2026-10-25`.

## Pengingat pagi

`vercel.json` menjadwalkan `/api/cron-pagi` setiap hari pukul 00:00 UTC = **07:00 WIB**. Satu pesan berisi tugas terlambat, tugas hari ini, dan item planner yang sudah jatuh tempo. **Kalau tidak ada yang perlu diingatkan, tidak ada pesan yang dikirim.**

Batasan Vercel paket Hobby: cron hanya boleh sekali sehari dan waktunya bisa meleset hingga sekitar satu jam (jadi 07.00–07.59 WIB).

---

# Kuota Fonnte

Setiap pesan keluar yang sukses dikirim dicatat di tab `PesanKeluar`. Ketik `kuota` untuk melihat pemakaian bulan ini; pengingat pagi menambahkan peringatan otomatis begitu pemakaian mencapai 80% dari `FONNTE_QUOTA`.

Cara menghemat: bot **tidak membalas** pesan yang bukan perintah, pengingat hanya 1 pesan/hari dan dilewati kalau kosong, dan `todo tambah` bisa memuat banyak tugas sekaligus. Bantuan hanya dikirim saat kamu mengetik `help`, `help planner`, `help todo`, atau `help keuangan`.

---

# Keamanan

- Isi `OWNER_NUMBER`. Tanpa itu bot menerima perintah dari siapa pun yang mengirim pesan ke nomor bot (dan mencatat peringatan di log).
- Isi `CRON_SECRET` supaya endpoint `/api/cron-pagi` tidak bisa dipicu orang lain.


## Ide pengembangan lanjutan

- **Riwayat per rekening**: command `riwayat ACC-04` yang menampilkan beberapa transaksi terakhir dari sheet Log yang melibatkan rekening tsb.
- **Reminder piutang jatuh tempo**: tambahkan kolom `JatuhTempo` di Log khusus baris "Beri Hutang", lalu buat Vercel Cron Job yang mengecek dan mengirim reminder otomatis.
- **Multi-user**: validasi pengirim sudah ada (`OWNER_NUMBER`, satu nomor). Kalau perlu lebih dari satu nomor, ubah menjadi daftar nomor dipisah koma.
