const { formatRupiah } = require("./parser");

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

function accountLabel(acc) {
  return `${acc.id} (${acc.bank} - ${acc.pemilik})`;
}

function helpText() {
  return (
    `❓ *Format Tidak Dikenali*\n${DIVIDER}\n\n` +
    `Coba salah satu format berikut:\n\n` +
    `📥 *Uang Masuk*\n` +
    "```masuk <rekening> <nominal> <ket>```\n" +
    `_Contoh: masuk 1 500000 gaji_\n\n` +
    `📤 *Uang Keluar*\n` +
    "```keluar <rekening> <nominal> <ket>```\n" +
    `_Contoh: keluar 2 15000 makan siang_\n\n` +
    `🤝 *Beri Hutang*\n` +
    "```hutang <asal> <tujuan> <nominal> <resmi/tidak resmi> <ket>```\n" +
    `_Contoh: hutang 1 4 500000 tidak resmi beli modal_\n\n` +
    `💵 *Bayar Hutang*\n` +
    "```bayar <peminjam> <tujuan> <nominal> <resmi/tidak resmi> <ket>```\n" +
    `_Contoh: bayar 4 1 200000 tidak resmi cicilan 1_\n\n` +
    `${DIVIDER}\n` +
    `📊 Ketik *saldo* → ringkasan aset\n` +
    `📒 Ketik *rekening* → daftar rekening`
  );
}

function ambiguousReply(candidates) {
  const list = candidates.map((a) => `• ${accountLabel(a)}`).join("\n");
  return `⚠️ *Ada Beberapa Rekening Cocok*\n${DIVIDER}\nTolong sebutkan ID yang spesifik:\n${list}`;
}

function notFoundReply(query) {
  return (
    `⚠️ *Rekening Tidak Ditemukan*\n${DIVIDER}\n` +
    `Rekening "${query}" tidak ada di daftar.\n` +
    `Ketik *rekening* untuk lihat daftar lengkap.`
  );
}

function listReply(sendiriAccounts, pihakLuarAccounts) {
  const sendiriLines = sendiriAccounts.length
    ? sendiriAccounts.map((a) => `• ${accountLabel(a)}\n   💰 ${formatRupiah(a.saldoRiil)}`).join("\n\n")
    : "_(belum ada rekening)_";

  const piutangLines = pihakLuarAccounts.length
    ? pihakLuarAccounts.map((a) => `• ${accountLabel(a)}\n   📌 ${formatRupiah(a.saldoRiil)}`).join("\n\n")
    : "_(tidak ada piutang aktif)_";

  return (
    `📒 *DAFTAR REKENING*\n${DIVIDER}\n\n` +
    `🏦 *Rekening Sendiri*\n${sendiriLines}\n\n` +
    `🤝 *Piutang ke Pihak Luar*\n${piutangLines}`
  );
}

function saldoReply({ sendiriAccounts, piutangMap, pihakLuarAccounts, totalAsetAsli }) {
  const sendiriLines = sendiriAccounts
    .map((a) => {
      const piutang = piutangMap[a.id] || 0;
      const total = a.saldoRiil + piutang;
      const detail =
        piutang !== 0
          ? `\n   kas ${formatRupiah(a.saldoRiil)} + piutang ${formatRupiah(piutang)}`
          : "";
      return `• ${accountLabel(a)}${detail}\n   = *${formatRupiah(total)}*`;
    })
    .join("\n\n") || "_(belum ada rekening)_";

  const piutangLines = pihakLuarAccounts.length
    ? pihakLuarAccounts.map((a) => `• ${accountLabel(a)}: ${formatRupiah(a.saldoRiil)}`).join("\n")
    : "_(tidak ada)_";

  return (
    `📊 *RINGKASAN ASET*\n${DIVIDER}\n\n` +
    `🏦 *Rekening Sendiri*\n${sendiriLines}\n\n` +
    `🤝 *Hutang Piutang (Pihak Luar)*\n${piutangLines}\n\n` +
    `${DIVIDER}\n` +
    `💎 *Total Aset Asli: ${formatRupiah(totalAsetAsli)}*`
  );
}

function transactionReply({ kind, acc, amount, note, newSaldo }) {
  const isMasuk = kind === "masuk";
  const icon = isMasuk ? "📥" : "📤";
  const label = isMasuk ? "Uang Masuk" : "Uang Keluar";
  const symbol = isMasuk ? "+" : "-";

  return (
    `✅ *${label} Tercatat*\n${DIVIDER}\n\n` +
    `${icon} ${accountLabel(acc)}\n` +
    `💵 ${symbol}${formatRupiah(amount)}\n` +
    `📝 ${note}\n\n` +
    `${DIVIDER}\n` +
    `💰 Saldo sekarang: *${formatRupiah(newSaldo)}*`
  );
}

function hutangBayarReply({ kind, asal, tujuan, amount, status, note, totalAsetAsli }) {
  const isHutang = kind === "hutang";
  const label = isHutang ? "Beri Hutang" : "Bayar Hutang";
  const icon = isHutang ? "🤝" : "💵";

  return (
    `✅ *${label} Tercatat*\n${DIVIDER}\n\n` +
    `${icon} ${accountLabel(asal)}\n   ⬇️\n${accountLabel(tujuan)}\n\n` +
    `💵 ${formatRupiah(amount)}\n` +
    `🏷️ ${status}\n` +
    `📝 ${note}\n\n` +
    `${DIVIDER}\n` +
    `💎 Total Aset Asli tetap: *${formatRupiah(totalAsetAsli)}*`
  );
}

module.exports = {
  accountLabel,
  helpText,
  ambiguousReply,
  notFoundReply,
  listReply,
  saldoReply,
  transactionReply,
  hutangBayarReply,
};
