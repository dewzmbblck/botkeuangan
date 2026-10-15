const { resolveAccount, updateBalance, writeDashboard } = require("./accounts");
const { appendLog, loadLog } = require("./sheets");
const { notFoundReply, ambiguousReply } = require("./messages");

/**
 * Jembatan Planner -> saldo rekening. Memakai fungsi keuangan yang sudah ada
 * (updateBalance, appendLog, writeDashboard), jadi Log & Dashboard tetap konsisten
 * dengan transaksi yang diketik manual.
 *
 * Objek account yang dikirim ikut diubah (saldoRiil) supaya dashboard yang ditulis
 * ulang memakai angka terbaru tanpa baca ulang sheet Master.
 */

function accountLabel(acc) {
  return `${acc.id} (${acc.bank} - ${acc.pemilik})`;
}

/** Cari rekening, wajib kategori Sendiri. Return { acc } atau { error: "teks balasan" }. */
function resolveSendiri(query, accounts) {
  const r = resolveAccount(query, accounts);
  if (r.notFound) return { error: notFoundReply(query) };
  if (r.ambiguous) return { error: ambiguousReply(r.ambiguous) };
  if (r.found.kategori.toLowerCase() !== "sendiri") {
    return { error: `⚠️ Rekening ${r.found.id} bukan rekening sendiri, tidak bisa dipakai untuk planner.` };
  }
  return { acc: r.found };
}

async function postMasuk(acc, amount, notes, sender) {
  const newSaldo = acc.saldoRiil + amount;
  await updateBalance(acc.row, newSaldo);
  await appendLog({
    jenis: "Uang Masuk",
    rekeningAsal: "-",
    rekeningTujuan: acc.id,
    nominal: amount,
    notes,
    sender,
    via: "Planner",
  });
  acc.saldoRiil = newSaldo;
  return newSaldo;
}

async function postKeluar(acc, amount, notes, sender) {
  const newSaldo = acc.saldoRiil - amount;
  await updateBalance(acc.row, newSaldo);
  await appendLog({
    jenis: "Uang Keluar",
    rekeningAsal: acc.id,
    rekeningTujuan: "-",
    nominal: amount,
    notes,
    sender,
    via: "Planner",
  });
  acc.saldoRiil = newSaldo;
  return newSaldo;
}

/** Pindah saldo antar rekening SENDIRI. Jenis "Transfer" tidak dihitung sebagai piutang. */
async function postTransfer(asal, tujuan, amount, notes, sender) {
  const saldoAsal = asal.saldoRiil - amount;
  const saldoTujuan = tujuan.saldoRiil + amount;
  await updateBalance(asal.row, saldoAsal);
  await updateBalance(tujuan.row, saldoTujuan);
  await appendLog({
    jenis: "Transfer",
    rekeningAsal: asal.id,
    rekeningTujuan: tujuan.id,
    nominal: amount,
    notes,
    sender,
    via: "Planner",
  });
  asal.saldoRiil = saldoAsal;
  tujuan.saldoRiil = saldoTujuan;
  return { saldoAsal, saldoTujuan };
}

async function syncDashboard(accounts) {
  const logRows = await loadLog();
  await writeDashboard(accounts, logRows);
}

module.exports = { accountLabel, resolveSendiri, postMasuk, postKeluar, postTransfer, syncDashboard };
