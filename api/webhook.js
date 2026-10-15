const { parseMessage, isCommand } = require("../lib/parser");
const { loadAccounts, resolveAccount, updateBalance, computeDashboard, attributePiutang, writeDashboard } = require("../lib/accounts");
const { appendLog, loadLog } = require("../lib/sheets");
const { sendMessage } = require("../lib/fonnte");
const { isPlannerCommand, handlePlanner } = require("../lib/planner");
const { isTodoCommand, handleTodo } = require("../lib/todo");
const { helpFor } = require("../lib/help");
const { hitung, limit } = require("../lib/kuota");
const { wib, periodeLabel } = require("../lib/time");
const {
  helpText,
  ambiguousReply,
  notFoundReply,
  listReply,
  saldoReply,
  transactionReply,
  hutangBayarReply,
} = require("../lib/messages");

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ status: "ok", message: "Webhook endpoint is alive" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let sender;
  try {
    const body = req.body || {};
    sender = body.sender;
    const message = body.message;
    if (!sender || !message || typeof message !== "string") {
      res.status(200).json({ status: "ignored", reason: "no sender/message" });
      return;
    }

    // --- Validasi pengirim: hanya OWNER_NUMBER yang boleh memakai bot ---
    const owner = normalizePhone(process.env.OWNER_NUMBER);
    if (owner) {
      if (normalizePhone(sender) !== owner) {
        res.status(200).json({ status: "ignored", reason: "sender not allowed" });
        return;
      }
    } else {
      console.warn("OWNER_NUMBER belum diisi: bot menerima perintah dari siapa pun!");
    }

    const text = message.trim();

    // --- Bantuan & kuota ---
    const helpMatch = text.match(/^(help|bantuan|menu)\b\s*(.*)$/i);
    if (helpMatch) {
      await sendMessage(sender, helpFor(helpMatch[2]));
      res.status(200).json({ status: "ok", type: "help" });
      return;
    }

    if (isCommand(message, ["kuota", "quota"])) {
      const now = wib();
      const used = await hitung(now.periode);
      const max = limit();
      await sendMessage(
        sender,
        `📶 *KUOTA FONNTE*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${periodeLabel(now.periode)}\nTerkirim: *${used}* / ${max}\nSisa: *${Math.max(max - used, 0)}*\n\n_Hanya menghitung pesan keluar yang dikirim bot ini._`
      );
      res.status(200).json({ status: "ok", type: "kuota" });
      return;
    }

    // --- Planner bulanan ---
    if (isPlannerCommand(text)) {
      await sendMessage(sender, await handlePlanner(text, sender));
      res.status(200).json({ status: "ok", type: "planner" });
      return;
    }

    // --- Todo ---
    if (isTodoCommand(text)) {
      await sendMessage(sender, await handleTodo(text));
      res.status(200).json({ status: "ok", type: "todo" });
      return;
    }

    // --- Pesan yang bukan perintah keuangan diabaikan diam-diam (hemat kuota) ---
    const isFinanceVerb = /^(masuk|keluar|hutang|bayar)\b/i.test(text);
    const isFinanceCmd = isCommand(message, ["rekening", "daftar rekening", "list rekening", "saldo", "rekap", "cek saldo"]);
    if (!isFinanceVerb && !isFinanceCmd) {
      res.status(200).json({ status: "ignored", reason: "not a command" });
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
    if (sender) {
      try {
        await sendMessage(sender, `⚠️ Terjadi kesalahan: ${err.message}\nCoba lagi sebentar lagi.`);
      } catch (_) {
        // abaikan, error asli sudah tercatat di log
      }
    }
    res.status(200).json({ status: "error", message: err.message });
  }
};
