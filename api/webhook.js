const { parseMessage, isCommand } = require("../lib/parser");
const { loadAccounts, resolveAccount, updateBalance, computeDashboard, attributePiutang, writeDashboard } = require("../lib/accounts");
const { appendLog, loadLog } = require("../lib/sheets");
const { sendMessage } = require("../lib/fonnte");
const {
  helpText,
  ambiguousReply,
  notFoundReply,
  listReply,
  saldoReply,
  transactionReply,
  hutangBayarReply,
} = require("../lib/messages");

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ status: "ok", message: "Webhook endpoint is alive" });
    return;
  }

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
      const sendiriAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "sendiri");
      const pihakLuarAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "pihakluar");

      await sendMessage(sender, listReply(sendiriAccounts, pihakLuarAccounts));
      res.status(200).json({ status: "ok", type: "list" });
      return;
    }

    // --- Command: saldo / rekap ---
    if (isCommand(message, ["saldo", "rekap", "cek saldo"])) {
      const dash = computeDashboard(accounts);
      const logRows = await loadLog();
      const piutangMap = attributePiutang(accounts, logRows);
      await writeDashboard(accounts, logRows); // sinkronkan tab Dashboard, jaga-jaga kalau ada edit manual di Master

      const sendiriAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "sendiri");
      const pihakLuarAccounts = accounts.filter((a) => a.kategori.toLowerCase() === "pihakluar");

      const reply = saldoReply({
        sendiriAccounts,
        piutangMap,
        pihakLuarAccounts,
        totalAsetAsli: dash.totalAsetAsli,
      });

      await sendMessage(sender, reply);
      res.status(200).json({ status: "ok", type: "dashboard" });
      return;
    }

    // --- Transaksi ---
    const parsed = parseMessage(message);
    if (!parsed) {
      await sendMessage(sender, helpText());
      res.status(200).json({ status: "ignored", reason: "unparsed message" });
      return;
    }

    if (parsed.kind === "masuk" || parsed.kind === "keluar") {
      const result = resolveAccount(parsed.rekening, accounts);
      if (result.notFound) {
        await sendMessage(sender, notFoundReply(parsed.rekening));
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

      await appendLog({
        jenis: parsed.kind === "masuk" ? "Uang Masuk" : "Uang Keluar",
        rekeningAsal: parsed.kind === "keluar" ? acc.id : "-",
        rekeningTujuan: parsed.kind === "masuk" ? acc.id : "-",
        nominal: parsed.amount,
        notes: parsed.note,
        sender,
      });

      const freshLog = await loadLog();
      await writeDashboard(updatedAccounts, freshLog);

      await sendMessage(
        sender,
        transactionReply({ kind: parsed.kind, acc, amount: parsed.amount, note: parsed.note, newSaldo })
      );
      res.status(200).json({ status: "ok", type: parsed.kind });
      return;
    }

    if (parsed.kind === "hutang" || parsed.kind === "bayar") {
      const asalResult = resolveAccount(parsed.asal, accounts);
      const tujuanResult = resolveAccount(parsed.tujuan, accounts);

      if (asalResult.notFound || tujuanResult.notFound) {
        await sendMessage(sender, notFoundReply(asalResult.notFound ? parsed.asal : parsed.tujuan));
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
      const freshLog = await loadLog();
      await writeDashboard(updatedAccounts, freshLog);

      await sendMessage(
        sender,
        hutangBayarReply({
          kind: parsed.kind,
          asal,
          tujuan,
          amount: parsed.amount,
          status: parsed.status,
          note: parsed.note,
          totalAsetAsli: dash.totalAsetAsli,
        })
      );
      res.status(200).json({ status: "ok", type: parsed.kind });
      return;
    }

    // Fallback, seharusnya tidak pernah sampai sini
    await sendMessage(sender, helpText());
    res.status(200).json({ status: "ignored", reason: "unhandled kind" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ status: "error", message: err.message });
  }
};
