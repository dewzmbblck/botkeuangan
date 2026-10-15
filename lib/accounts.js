const { google } = require("googleapis");

/**
 * Sheet "Master" — kolom A sampai G, mulai baris 2:
 * A: ID | B: Bank | C: Pemilik | D: Kategori (Sendiri/PihakLuar) | E: SaldoRiil | F: Alias | G: Keterangan
 *
 * "row" pada objek account di bawah adalah nomor baris asli di sheet (1-based),
 * dipakai untuk update sel SaldoRiil secara langsung tanpa menulis ulang baris lain.
 */

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

async function loadAccounts() {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Master!A2:G",
  });

  const rows = res.data.values || [];

  return rows.map((row, index) => ({
    row: index + 2, // baris asli di sheet (header ada di baris 1)
    id: (row[0] || "").trim(),
    bank: (row[1] || "").trim(),
    pemilik: (row[2] || "").trim(),
    kategori: (row[3] || "").trim(), // "Sendiri" atau "PihakLuar"
    saldoRiil: parseFloat(row[4]) || 0,
    alias: (row[5] || "").trim(),
    keterangan: (row[6] || "").trim(),
  }));
}

/**
 * Cari akun berdasarkan query bebas: bisa ID (ACC-01), alias, atau nama bank.
 * Return { found: account } jika ketemu tepat satu,
 * { ambiguous: [accounts] } jika query cocok ke lebih dari satu akun,
 * atau { notFound: true } jika tidak ada yang cocok.
 */
function resolveAccount(query, accounts) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return { notFound: true };

  // 1. Cocok persis dengan ID
  const byId = accounts.find((a) => a.id.toLowerCase() === q);
  if (byId) return { found: byId };

  // 2. Cocok persis dengan Alias
  const byAlias = accounts.find((a) => a.alias.toLowerCase() === q);
  if (byAlias) return { found: byAlias };

  // 3. Cocok dengan nama bank (bisa lebih dari satu -> ambigu)
  const byBank = accounts.filter((a) => a.bank.toLowerCase() === q);
  if (byBank.length === 1) return { found: byBank[0] };
  if (byBank.length > 1) return { ambiguous: byBank };

  // 4. Substring match ke bank atau pemilik, sebagai upaya terakhir
  const bySubstring = accounts.filter(
    (a) => a.bank.toLowerCase().includes(q) || a.pemilik.toLowerCase().includes(q)
  );
  if (bySubstring.length === 1) return { found: bySubstring[0] };
  if (bySubstring.length > 1) return { ambiguous: bySubstring };

  return { notFound: true };
}

async function updateBalance(row, newSaldo) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Master!E${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[newSaldo]] },
  });
}

function computeDashboard(accounts) {
  const totalSendiri = accounts
    .filter((a) => a.kategori.toLowerCase() === "sendiri")
    .reduce((sum, a) => sum + a.saldoRiil, 0);

  const totalPiutang = accounts
    .filter((a) => a.kategori.toLowerCase() === "pihakluar")
    .reduce((sum, a) => sum + a.saldoRiil, 0);

  return {
    totalSendiri,
    totalPiutang,
    totalAsetAsli: totalSendiri + totalPiutang,
  };
}

/**
 * Hitung, untuk tiap rekening Sendiri, berapa piutang aktif yang asalnya
 * dari rekening itu (ditelusuri dari riwayat Log, bukan dari Master).
 * Rumus per rekening Sendiri:
 *   Piutang Teratribusi = SUM(nominal "Beri Hutang" dengan RekeningAsal = id)
 *                        - SUM(nominal "Bayar Hutang" dengan RekeningTujuan = id)
 * Totalnya akan selalu sama dengan Total Piutang Aktif di computeDashboard,
 * cuma dipecah per rekening asal supaya kamu tahu uang siapa yang masih dipinjam orang.
 */
function attributePiutang(accounts, logRows) {
  const sendiriIds = accounts
    .filter((a) => a.kategori.toLowerCase() === "sendiri")
    .map((a) => a.id);

  const piutangMap = {};
  sendiriIds.forEach((id) => (piutangMap[id] = 0));

  for (const log of logRows) {
    if (log.jenis === "Beri Hutang" && piutangMap.hasOwnProperty(log.rekeningAsal)) {
      piutangMap[log.rekeningAsal] += log.nominal;
    }
    if (log.jenis === "Bayar Hutang" && piutangMap.hasOwnProperty(log.rekeningTujuan)) {
      piutangMap[log.rekeningTujuan] -= log.nominal;
    }
  }

  return piutangMap;
}

/**
 * Tulis ulang tab "Dashboard" dengan 2 bagian terpisah:
 * - Rekening Sendiri -> Saldo Riil (kas) + Piutang Teratribusi = Total Aset Bersih per rekening
 * - Rekening Pihak Luar -> kolom "Hutang Piutang" (uang yang masih dipinjam orang, bukan kas di tanganmu)
 * Diikuti ringkasan total di bagian bawah.
 */
async function writeDashboard(accounts, logRows) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const dash = computeDashboard(accounts);
  const piutangMap = attributePiutang(accounts, logRows || []);

  const sendiriAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "sendiri");
  const pihakLuarAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "pihakluar");

  const values = [
    ["REKENING SENDIRI", "", "", "", ""],
    ["ID", "Bank", "Pemilik", "Saldo Riil (Kas)", "Piutang", "Total Aset Bersih"],
    ...sendiriAccounts.map((a) => {
      const piutang = piutangMap[a.id] || 0;
      return [a.id, a.bank, a.pemilik, a.saldoRiil, piutang, a.saldoRiil + piutang];
    }),
    ["", "", "", "", "", ""],
    ["REKENING PIHAK LUAR (HUTANG PIUTANG)", "", "", "", "", ""],
    ["ID", "Bank", "Pemilik", "Hutang Piutang", "", ""],
    ...pihakLuarAccounts.map((a) => [a.id, a.bank, a.pemilik, a.saldoRiil, "", ""]),
    ["", "", "", "", "", ""],
    ["RINGKASAN", "", "", "", "", ""],
    ["", "", "", "Total Aset Bersih (Rekening Sendiri)", "", dash.totalSendiri],
    ["", "", "", "Total Hutang Piutang (Pihak Luar)", "", dash.totalPiutang],
    ["", "", "", "Total Aset Asli", "", dash.totalAsetAsli],
  ];

  // Bersihkan dulu supaya baris lama (kalau jumlah rekening berubah) tidak nyangkut
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Dashboard!A1:F200",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Dashboard!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

module.exports = { loadAccounts, resolveAccount, updateBalance, computeDashboard, attributePiutang, writeDashboard };
