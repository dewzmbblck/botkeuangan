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

module.exports = { appendLog };
