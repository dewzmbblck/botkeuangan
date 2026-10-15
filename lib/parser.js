/**
 * Format pesan yang didukung (tidak case-sensitive):
 *
 *   masuk <rekening> <nominal> <keterangan>
 *     contoh: "masuk ACC-01 500000 gaji"  atau  "masuk BCA 500000 gaji"
 *
 *   keluar <rekening> <nominal> <keterangan>
 *     contoh: "keluar ACC-02 15000 makan siang"
 *
 *   hutang <rekening asal> <rekening tujuan peminjam> <nominal> <resmi|tidak resmi> <notes>
 *     contoh: "hutang ACC-01 ACC-04 500000 tidak resmi beli modal"
 *
 *   bayar <rekening peminjam> <rekening tujuan saya> <nominal> <resmi|tidak resmi> <notes>
 *     contoh: "bayar ACC-04 ACC-01 200000 tidak resmi cicilan 1"
 *
 *   saldo / rekap   -> ringkasan total aset
 *   rekening / daftar rekening -> daftar semua rekening & saldo riil
 */

function parseAmount(raw) {
  const cleaned = (raw || "").replace(/[.,]/g, "");
  const amount = parseInt(cleaned, 10);
  return isNaN(amount) ? null : amount;
}

function parseMasukKeluar(text) {
  const match = text.match(/^(masuk|keluar)\s+(\S+)\s+([\d.,]+)\s*(.*)$/i);
  if (!match) return null;

  const [, typeRaw, rekening, amountRaw, noteRaw] = match;
  const amount = parseAmount(amountRaw);
  if (!amount || amount <= 0) return null;

  return {
    kind: typeRaw.toLowerCase() === "masuk" ? "masuk" : "keluar",
    rekening,
    amount,
    note: noteRaw.trim() || "-",
  };
}

function parseHutangBayar(text) {
  const match = text.match(
    /^(hutang|bayar)\s+(\S+)\s+(\S+)\s+([\d.,]+)\s+(tidak resmi|resmi)\s*(.*)$/i
  );
  if (!match) return null;

  const [, kindRaw, asal, tujuan, amountRaw, statusRaw, noteRaw] = match;
  const amount = parseAmount(amountRaw);
  if (!amount || amount <= 0) return null;

  return {
    kind: kindRaw.toLowerCase() === "hutang" ? "hutang" : "bayar",
    asal,
    tujuan,
    amount,
    status: statusRaw.toLowerCase() === "resmi" ? "Resmi" : "Tidak Resmi",
    note: noteRaw.trim() || "-",
  };
}

function parseMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") return null;
  const text = rawMessage.trim();

  const masukKeluar = parseMasukKeluar(text);
  if (masukKeluar) return masukKeluar;

  const hutangBayar = parseHutangBayar(text);
  if (hutangBayar) return hutangBayar;

  return null;
}

function isCommand(rawMessage, keywords) {
  if (!rawMessage || typeof rawMessage !== "string") return false;
  return keywords.includes(rawMessage.trim().toLowerCase());
}

function formatRupiah(amount) {
  const sign = amount < 0 ? "-" : "";
  return sign + "Rp" + Math.abs(amount).toLocaleString("id-ID");
}

module.exports = { parseMessage, isCommand, formatRupiah };
