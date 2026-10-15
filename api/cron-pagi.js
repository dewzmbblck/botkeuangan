const { ensureTabs } = require("../lib/gsheets");
const { wib } = require("../lib/time");
const { collectPagi } = require("../lib/todo");
const { collectDue } = require("../lib/planner");
const { hitung, limit } = require("../lib/kuota");
const { buildPagiMessage } = require("../lib/pagi");
const { sendMessage } = require("../lib/fonnte");

/**
 * Dipanggil Vercel Cron tiap pagi (lihat vercel.json). Vercel otomatis menyertakan
 * header "Authorization: Bearer <CRON_SECRET>" kalau env CRON_SECRET diisi.
 * Mengirim maksimal 1 pesan per hari, dan tidak mengirim apa pun kalau tidak ada yang perlu diingat.
 */
module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const owner = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  if (!owner) {
    res.status(500).json({ error: "OWNER_NUMBER belum diisi" });
    return;
  }

  try {
    await ensureTabs();
    const now = wib();
    const [todo, planDue, used] = await Promise.all([collectPagi(now), collectDue(now), hitung(now.periode)]);

    const text = buildPagiMessage({ now, todo, planDue, kuota: { used, limit: limit() } });
    if (!text) {
      res.status(200).json({ status: "ok", sent: false, reason: "tidak ada pengingat" });
      return;
    }

    await sendMessage(owner, text, "pengingat");
    res.status(200).json({ status: "ok", sent: true });
  } catch (err) {
    console.error("Cron error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
};
