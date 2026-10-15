const { helpText } = require("./messages");

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

function menuText() {
  return (
    `📖 *MENU BOT*\n${DIVIDER}\n\n` +
    `💰 *Keuangan* → ketik \`help keuangan\`\n` +
    `masuk · keluar · hutang · bayar · saldo · rekening\n\n` +
    `📅 *Planner Bulanan* → ketik \`help planner\`\n` +
    `gaji · lunas · pisah · plan · sisa\n\n` +
    `✅ *Todo* → ketik \`help todo\`\n` +
    `todo · todo tambah · todo selesai\n\n` +
    `📶 \`kuota\` → sisa kuota pesan bulan ini`
  );
}

function plannerHelp() {
  return (
    `📅 *PLANNER BULANAN*\n${DIVIDER}\n\n` +
    `*Tiap bulan:*\n` +
    "```gaji <nominal> [rekening]```\n" +
    `_gaji 2900000 bca-saya → saldo rekening bertambah + daftar bulan ini dibuat dari template_\n\n` +
    "```lunas <item|no> [nominal] [dari <rek>]```\n" +
    `_lunas listrik → ditandai terbayar (dan saldo terpotong kalau rekening terhubung)_\n\n` +
    "```pisah <item|no> [nominal] [dari <rek> ke <rek>]```\n" +
    `_pisah 2 → ditandai terpisah (dan uang dipindah antar rekening kalau diisi)_\n\n` +
    `*Lihat & atur:*\n` +
    "```plan``` checklist bulan ini\n" +
    "```sisa``` estimasi sisa uang (gaji − alokasi − pengeluaran bebas)\n" +
    "```plan batal <item|no>``` batalkan + kembalikan saldo\n" +
    "```plan item``` daftar template\n" +
    "```plan item tambah <nama> <nominal> <bayar|pisah> [tgl] [dari <rek>] [ke <rek>]```\n" +
    "```plan item hapus <nama>```"
  );
}

function todoHelp() {
  return (
    `✅ *TODO*\n${DIVIDER}\n` +
    "```todo``` hari ini + terlambat\n" +
    "```todo semua``` · ```todo kerja``` · ```todo kuliah``` · ```todo lain```\n" +
    "```todo tambah <kerja|kuliah|lain> <tugas> | <tenggat>```\n" +
    `_Tambah banyak sekaligus: tulis tiap tugas di baris baru (hemat kuota)._\n` +
    "```todo selesai <id> [id ...]```\n" +
    "```todo edit <id> <teks> | <tenggat>```\n" +
    "```todo tunda <id> <tenggat>```\n" +
    "```todo pindah <id> <kategori>```\n" +
    "```todo buka <id>``` · ```todo hapus <id>``` · ```todo riwayat```\n\n" +
    `_Tenggat: hari ini, besok, lusa, senin..minggu, +3, 25/10, 25 okt. Tanpa tenggat = hari ini._\n` +
    `_Pengingat otomatis tiap pagi (±07.00 WIB)._`
  );
}

function helpFor(topic) {
  const t = (topic || "").toLowerCase();
  if (t.startsWith("plan")) return plannerHelp();
  if (t.startsWith("todo") || t.startsWith("tugas")) return todoHelp();
  if (t.startsWith("keu")) return helpText();
  return menuText();
}

module.exports = { helpFor };
