const { getRows, appendRows, ensureTabs } = require("./gsheets");
const { wib } = require("./time");

/**
 * Penghitung kuota pesan Fonnte.
 * Setiap pesan KELUAR yang sukses dikirim dicatat 1 baris di tab "PesanKeluar".
 * Batas bulanan diatur lewat env FONNTE_QUOTA (default 1000).
 */

function limit() {
  return parseInt(process.env.FONNTE_QUOTA || "1000", 10) || 1000;
}

async function catat(tipe = "reply") {
  await ensureTabs();
  const n = wib();
  await appendRows("PesanKeluar!A:C", [[`${n.iso} ${n.hh}:${n.mm}`, n.periode, tipe]]);
}

async function hitung(periode) {
  await ensureTabs();
  const rows = await getRows("PesanKeluar!B2:B");
  return rows.filter((r) => String(r[0]) === periode).length;
}

module.exports = { catat, hitung, limit };
