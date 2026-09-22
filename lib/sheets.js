const { google } = require("googleapis");

/**
 * Sheet "Log" — kolom A sampai I:
 * A: Tanggal | B: Jenis | C: RekeningAsal | D: RekeningTujuan | E: Nominal
 * F: StatusResmi | G: Via | H: Notes | I: Pengirim
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

async function appendLog({ jenis, rekeningAsal, rekeningTujuan, nominal, status, via, notes, sender }) {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tanggal = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Log!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        tanggal,
        jenis,
        rekeningAsal || "-",
        rekeningTujuan || "-",
        nominal,
        status || "-",
        via || "WhatsApp",
        notes || "-",
        sender || "-",
      ]],
    },
  });
}

/**
 * Baca seluruh baris Log, dipakai untuk menelusuri dari rekening Sendiri mana
 * asal setiap piutang yang masih aktif (lihat accounts.js -> attributePiutang).
 */
async function loadLog() {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Log!A2:I",
  });

  const rows = res.data.values || [];

  return rows.map((row) => ({
    tanggal: row[0] || "",
    jenis: row[1] || "",
    rekeningAsal: row[2] || "",
    rekeningTujuan: row[3] || "",
    nominal: parseFloat(row[4]) || 0,
    status: row[5] || "",
  }));
}

module.exports = { appendLog, loadLog };
