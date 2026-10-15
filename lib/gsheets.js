const { google } = require("googleapis");

/**
 * Helper Google Sheets bersama untuk modul Planner, Todo, dan Kuota.
 * (Modul keuangan lama - accounts.js & sheets.js - dibiarkan apa adanya.)
 *
 * Semua data ditulis dengan valueInputOption RAW supaya teks seperti "2026-10-15"
 * atau "2026-10" tidak diubah Google Sheets menjadi tanggal.
 */

// Tab baru yang dibuat otomatis kalau belum ada.
const TABS = [
  {
    title: "Todo",
    headers: ["ID", "Kategori", "Tugas", "Deadline", "Status", "Dibuat", "TanggalSelesai"],
  },
  {
    title: "PlannerTemplate",
    headers: ["Item", "Nominal", "Jenis", "JatuhTempo", "Rekening", "RekeningTujuan", "Aktif"],
  },
  {
    title: "PlannerGaji",
    headers: ["Periode", "Tanggal", "Nominal", "Rekening", "Catatan"],
  },
  {
    title: "Planner",
    headers: [
      "Periode", "Item", "Nominal", "Jenis", "JatuhTempo", "Status",
      "TanggalSelesai", "Rekening", "RekeningTujuan", "Terealisasi", "Catatan",
    ],
  },
  {
    title: "PesanKeluar",
    headers: ["Waktu", "Periode", "Tipe"],
  },
];

let _client = null;
let _ensured = false;

function client() {
  if (_client) return _client;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  _client = google.sheets({ version: "v4", auth });
  return _client;
}

const sheetId = () => process.env.GOOGLE_SHEET_ID;

async function getRows(range) {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return res.data.values || [];
}

async function appendRows(range, rows) {
  if (!rows.length) return;
  await client().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

async function setRange(range, values) {
  await client().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/**
 * Pastikan semua tab baru ada (dibuat + header otomatis kalau belum).
 * Hasilnya di-cache per instance serverless, jadi biasanya hanya 1 panggilan API
 * pada cold start.
 */
async function ensureTabs() {
  if (_ensured) return;

  const meta = await client().spreadsheets.get({
    spreadsheetId: sheetId(),
    fields: "sheets.properties.title",
  });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const missing = TABS.filter((t) => !existing.has(t.title));

  if (missing.length) {
    try {
      await client().spreadsheets.batchUpdate({
        spreadsheetId: sheetId(),
        requestBody: {
          requests: missing.map((t) => ({ addSheet: { properties: { title: t.title } } })),
        },
      });
    } catch (err) {
      // Dua instance cold-start bersamaan bisa saling mendahului: abaikan "already exists".
      if (!/already exists/i.test(err.message || "")) throw err;
    }
    for (const t of missing) {
      await setRange(`${t.title}!A1`, [t.headers]);
    }
  }

  _ensured = true;
}

module.exports = { getRows, appendRows, setRange, ensureTabs, TABS };
