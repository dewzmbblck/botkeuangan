const { parseMessage, isCommand, formatRupiah } = require("../lib/parser");
const { loadAccounts, resolveAccount, updateBalance, computeDashboard, writeDashboard } = require("../lib/accounts");
const { appendLog } = require("../lib/sheets");
const { sendMessage } = require("../lib/fonnte");

const HELP_TEXT =
  "Format tidak dikenali 🤔\n\n" +
  "Contoh perintah yang didukung:\n" +
  "- masuk 1 500000 gaji\n" +
  "- keluar 2 15000 makan siang\n" +
  "- hutang 1 4 500000 tidak resmi beli modal\n" +
  "- bayar 4 1 200000 tidak resmi cicilan 1\n\n" +
  "Ketik \"saldo\" untuk ringkasan aset, atau \"rekening\" untuk daftar rekening.";

function accountLabel(acc) {
  return `${acc.id} (${acc.bank} - ${acc.pemilik})`;
}

function ambiguousReply(candidates) {
  const list = candidates.map((a) => `- ${accountLabel(a)}`).join("\n");
  return `Ada lebih dari satu rekening yang cocok, tolong pakai ID-nya:\n${list}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { sender, message } = req.body;
    if (!sender || !message) {
      res.status(200).json({ status: "ignored", reason: "no sender/message" });
      return;
    }

    const accounts = await loadAccounts();

    // --- Command: daftar rekening ---
    if (isCommand(message, ["rekening", "daftar rekening", "list rekening"])) {
      const list = accounts
        .map((a) => `- ${accountLabel(a)}: ${formatRupiah(a.saldoRiil)}`)
        .join("\n");
      await sendMessage(sender, `📒 Daftar Rekening\n${list}`);
      res.status(200).json({ status: "ok", type: "list" });
      return;
    }

    // --- Command: saldo / rekap ---
    if (isCommand(message, ["saldo", "rekap", "cek saldo"])) {
      const dash = computeDashboard(accounts);
      await writeDashboard(accounts); // sinkronkan tab Dashboard, jaga-jaga kalau ada edit manual di Master
      const reply =
        `📊 Ringkasan Aset\n` +
        `Total Saldo Rekening Sendiri: ${formatRupiah(dash.totalSendiri)}\n` +
        `Total Piutang Aktif: ${formatRupiah(dash.totalPiutang)}\n` +
        `Total Aset Asli: ${formatRupiah(dash.totalAsetAsli)}`;
      await sendMessage(sender, reply);
      res.status(200).json({ status: "ok", type: "dashboard" });
      return;
    }

    // --- Transaksi ---
    const parsed = parseMessage(message);
    if (!parsed) {
      await sendMessage(sender, HELP_TEXT);
      res.status(200).json({ status: "ignored", reason: "unparsed message" });
      return;
    }

    if (parsed.kind === "masuk" || parsed.kind === "keluar") {
      const result = resolveAccount(parsed.rekening, accounts);
      if (result.notFound) {
        await sendMessage(sender, `Rekening "${parsed.rekening}" tidak ditemukan. Ketik "rekening" untuk lihat daftar.`);
        res.status(200).json({ status: "ignored", reason: "account not found" });
        return;
      }
      if (result.ambiguous) {
        await sendMessage(sender, ambiguousReply(result.ambiguous));
        res.status(200).json({ status: "ignored", reason: "ambiguous account" });
        return;
      }

      const acc = result.found;
      const delta = parsed.kind === "masuk" ? parsed.amount : -parsed.amount;
      const newSaldo = acc.saldoRiil + delta;
      await updateBalance(acc.row, newSaldo);

      const updatedAccounts = accounts.map((a) => (a.row === acc.row ? { ...a, saldoRiil: newSaldo } : a));
      await writeDashboard(updatedAccounts);

      await appendLog({
        jenis: parsed.kind === "masuk" ? "Uang Masuk" : "Uang Keluar",
        rekeningAsal: parsed.kind === "keluar" ? acc.id : "-",
        rekeningTujuan: parsed.kind === "masuk" ? acc.id : "-",
        nominal: parsed.amount,
        notes: parsed.note,
        sender,
      });

      const symbol = parsed.kind === "masuk" ? "+" : "-";
      await sendMessage(
        sender,
        `✅ ${accountLabel(acc)}\n${symbol}${formatRupiah(parsed.amount)} (${parsed.note})\nSaldo sekarang: ${formatRupiah(newSaldo)}`
      );
      res.status(200).json({ status: "ok", type: parsed.kind });
      return;
    }

    if (parsed.kind === "hutang" || parsed.kind === "bayar") {
      const asalResult = resolveAccount(parsed.asal, accounts);
      const tujuanResult = resolveAccount(parsed.tujuan, accounts);

      if (asalResult.notFound || tujuanResult.notFound) {
        await sendMessage(sender, `Salah satu rekening tidak ditemukan. Ketik "rekening" untuk lihat daftar.`);
        res.status(200).json({ status: "ignored", reason: "account not found" });
        return;
      }
      if (asalResult.ambiguous) {
        await sendMessage(sender, ambiguousReply(asalResult.ambiguous));
        res.status(200).json({ status: "ignored", reason: "ambiguous account" });
        return;
      }
      if (tujuanResult.ambiguous) {
        await sendMessage(sender, ambiguousReply(tujuanResult.ambiguous));
        res.status(200).json({ status: "ignored", reason: "ambiguous account" });
        return;
      }

      const asal = asalResult.found;
      const tujuan = tujuanResult.found;

      const newSaldoAsal = asal.saldoRiil - parsed.amount;
      const newSaldoTujuan = tujuan.saldoRiil + parsed.amount;

      await updateBalance(asal.row, newSaldoAsal);
      await updateBalance(tujuan.row, newSaldoTujuan);

      await appendLog({
        jenis: parsed.kind === "hutang" ? "Beri Hutang" : "Bayar Hutang",
        rekeningAsal: asal.id,
        rekeningTujuan: tujuan.id,
        nominal: parsed.amount,
        status: parsed.status,
        notes: parsed.note,
        sender,
      });

      const updatedAccounts = accounts.map((a) => {
        if (a.row === asal.row) return { ...a, saldoRiil: newSaldoAsal };
        if (a.row === tujuan.row) return { ...a, saldoRiil: newSaldoTujuan };
        return a;
      });
      const dash = computeDashboard(updatedAccounts);
      await writeDashboard(updatedAccounts);

      const verb = parsed.kind === "hutang" ? "Beri Hutang" : "Bayar Hutang";
      const reply =
        `✅ ${verb} (${parsed.status})\n` +
        `${accountLabel(asal)} → ${accountLabel(tujuan)}\n` +
        `Nominal: ${formatRupiah(parsed.amount)} (${parsed.note})\n` +
        `Total Aset Asli tetap: ${formatRupiah(dash.totalAsetAsli)}`;

      await sendMessage(sender, reply);
      res.status(200).json({ status: "ok", type: parsed.kind });
      return;
    }

    // Fallback, seharusnya tidak pernah sampai sini
    await sendMessage(sender, HELP_TEXT);
    res.status(200).json({ status: "ignored", reason: "unhandled kind" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ status: "error", message: err.message });
  }
};
