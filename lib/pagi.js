const { formatRupiah } = require("./parser");
const { fmtFull } = require("./time");
const { renderGrouped } = require("./todo");

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

/**
 * Susun SATU pesan pengingat pagi (todo + tagihan planner + peringatan kuota).
 * Return null kalau tidak ada yang perlu diingatkan, supaya tidak menghabiskan kuota.
 */
function buildPagiMessage({ now, todo, planDue, kuota }) {
  const nTodo = todo.overdue.length + todo.today.length;
  if (!nTodo && !planDue.length) return null;

  let out = `☀️ *Selamat pagi!*\n_${fmtFull(now.iso)}_\n${DIVIDER}\n`;

  if (todo.overdue.length) {
    out += `\n🔴 *Tugas terlambat (${todo.overdue.length})*\n${renderGrouped(todo.overdue, now.iso)}\n`;
  }
  if (todo.today.length) {
    out += `\n📌 *Tugas hari ini (${todo.today.length})*\n${renderGrouped(todo.today, now.iso)}\n`;
  }
  if (planDue.length) {
    const lines = planDue.map(
      (p) => `  ${p.lewat ? "⚠️" : "⏰"} ${p.item} — ${formatRupiah(p.nominal)} _(${p.jenis === "Pisah" ? "pisahkan" : "bayar"} tgl ${p.jatuh}${p.lewat ? ", lewat" : ""})_`
    );
    out += `\n💸 *Planner keuangan*\n${lines.join("\n")}\n_Ketik: lunas <item> / pisah <item>_\n`;
  }
  if (nTodo) out += `\n_Selesai? ketik: todo selesai <id>_`;

  if (kuota && kuota.used >= kuota.limit * 0.8) {
    out += `\n\n📶 _Kuota Fonnte: ${kuota.used}/${kuota.limit} terpakai bulan ini._`;
  }
  return out.trim();
}

module.exports = { buildPagiMessage };
