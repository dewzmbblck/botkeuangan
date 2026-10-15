const { getRows, appendRows, setRange, ensureTabs } = require("./gsheets");
const { wib, diffDays, fmtShort, fmtFull, normDate, parseDeadline } = require("./time");

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

/**
 * TODO
 * Tab "Todo": A ID | B Kategori | C Tugas | D Deadline | E Status | F Dibuat | G TanggalSelesai
 * Status: Belum | Selesai | Dihapus   (tidak ada baris yang benar-benar dihapus dari sheet)
 *
 * Perintah:
 *   todo                           -> tugas hari ini + yang terlambat
 *   todo semua | todo kerja|kuliah|lain
 *   todo tambah <kategori> <tugas> [| <tenggat>]      (boleh banyak baris sekaligus)
 *   todo selesai <id> [id ...]     todo buka <id>
 *   todo edit <id> <teks> [| <tenggat>]   todo tunda <id> <tenggat>   todo pindah <id> <kategori>
 *   todo hapus <id> [id ...]       todo riwayat
 */

const CATEGORIES = ["Kerja", "Kuliah", "Lainnya"];
const ICON = { Kerja: "💼", Kuliah: "🎓", Lainnya: "📎" };
const CAT_ALIAS = {
  kerja: "Kerja",
  kuliah: "Kuliah",
  lain: "Lainnya",
  lainnya: "Lainnya",
  "lain-lain": "Lainnya",
};

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

async function loadTodos() {
  const rows = await getRows("Todo!A2:G");
  return rows
    .map((r, i) => ({
      row: i + 2,
      id: parseInt(r[0], 10),
      kat: CAT_ALIAS[str(r[1]).toLowerCase()] || "Lainnya",
      tugas: str(r[2]),
      deadline: normDate(r[3]),
      status: str(r[4]) || "Belum",
      dibuat: normDate(r[5]),
      selesai: normDate(r[6]),
    }))
    .filter((t) => !isNaN(t.id) && t.tugas);
}

function rowValues(t) {
  return [t.id, t.kat, t.tugas, t.deadline || "", t.status, t.dibuat || "", t.selesai || ""];
}

async function writeRow(t) {
  await setRange(`Todo!A${t.row}:G${t.row}`, [rowValues(t)]);
}

const byDeadline = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.id - b.id;

// ---------- tampilan ----------

function deadlineInfo(t, today) {
  if (!t.deadline) return "";
  const d = diffDays(t.deadline, today);
  if (d < 0) return ` _(telat ${-d} hari · ${fmtShort(t.deadline)})_`;
  if (d === 0) return " _(hari ini)_";
  if (d === 1) return " _(besok)_";
  return ` _(${fmtShort(t.deadline)} · ${d} hari lagi)_`;
}

function renderGrouped(tasks, today) {
  const blocks = [];
  for (const cat of CATEGORIES) {
    const items = tasks.filter((t) => t.kat === cat).sort(byDeadline);
    if (!items.length) continue;
    blocks.push(
      `${ICON[cat]} *${cat}*\n` + items.map((t) => `  #${t.id} ${t.tugas}${deadlineInfo(t, today)}`).join("\n")
    );
  }
  return blocks.join("\n\n");
}

function dueSets(todos, today) {
  const open = todos.filter((t) => t.status === "Belum");
  return {
    overdue: open.filter((t) => t.deadline && t.deadline < today),
    today: open.filter((t) => t.deadline === today),
  };
}

function viewHariIni(todos, now) {
  const { overdue, today } = dueSets(todos, now.iso);
  if (!overdue.length && !today.length) {
    return `🎉 *Tidak ada tugas hari ini*\n${DIVIDER}\n_${fmtFull(now.iso)}_\nKetik \`todo semua\` untuk lihat seluruh tugas.`;
  }
  let out = `📋 *TUGAS HARI INI*\n_${fmtFull(now.iso)}_\n${DIVIDER}\n`;
  if (overdue.length) out += `\n🔴 *Terlambat (${overdue.length})*\n${renderGrouped(overdue, now.iso)}\n`;
  if (today.length) out += `\n📌 *Hari ini (${today.length})*\n${renderGrouped(today, now.iso)}\n`;
  return out.trim();
}

function viewSemua(todos, now, kat) {
  let open = todos.filter((t) => t.status === "Belum");
  if (kat) open = open.filter((t) => t.kat === kat);
  const title = kat ? `${ICON[kat]} TUGAS ${kat.toUpperCase()}` : "📋 SEMUA TUGAS AKTIF";
  if (!open.length) return `🎉 *${title}*\n${DIVIDER}\nTidak ada tugas yang belum selesai.`;
  return `*${title}* (${open.length})\n${DIVIDER}\n\n${renderGrouped(open, now.iso)}`;
}

function viewRiwayat(todos) {
  const done = todos
    .filter((t) => t.status === "Selesai")
    .sort((a, b) => (b.selesai || "").localeCompare(a.selesai || "") || b.id - a.id)
    .slice(0, 10);
  if (!done.length) return "Belum ada tugas yang selesai.";
  return (
    `✅ *10 TUGAS TERAKHIR SELESAI*\n${DIVIDER}\n` +
    done.map((t) => `#${t.id} ${t.tugas} _(${ICON[t.kat]} ${t.kat} · ${fmtShort(t.selesai)})_`).join("\n")
  );
}

function usage() {
  return (
    `❓ *Perintah Todo*\n${DIVIDER}\n` +
    "```todo``` hari ini + terlambat\n" +
    "```todo semua``` / ```todo kerja``` / ```todo kuliah``` / ```todo lain```\n" +
    "```todo tambah <kerja|kuliah|lain> <tugas> | <tenggat>```\n" +
    "```todo selesai <id> [id ...]```\n" +
    "```todo edit <id> <teks baru> | <tenggat>```\n" +
    "```todo tunda <id> <tenggat>```\n" +
    "```todo pindah <id> <kategori>```\n" +
    "```todo buka <id>``` (batalkan selesai)\n" +
    "```todo hapus <id>``` · ```todo riwayat```\n\n" +
    `_Tenggat: hari ini, besok, lusa, senin..minggu, +3, 25/10, 25 okt. Tanpa tenggat = hari ini._`
  );
}

// ---------- perintah ----------

function splitDeadline(line) {
  const m = line.match(/^(.*?)\s*[|@]\s*(.+)$/);
  return m ? { text: m[1].trim(), deadlineRaw: m[2].trim() } : { text: line.trim(), deadlineRaw: "" };
}

function parseIds(rest) {
  return (rest.match(/\d+/g) || []).map((n) => parseInt(n, 10));
}

async function cmdTambah(rest, extraLines, now) {
  const first = rest.match(/^(\S+)\s*(.*)$/);
  const kat = first ? CAT_ALIAS[first[1].toLowerCase()] : null;
  if (!kat) return `⚠️ Kategori harus *kerja*, *kuliah*, atau *lain*.\n_Contoh: todo tambah kerja laporan bulanan | jumat_`;

  const lines = [first[2], ...extraLines].map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return `⚠️ Tugasnya apa?\n_Contoh: todo tambah ${first[1].toLowerCase()} revisi proposal | besok_`;

  const parsed = [];
  for (const line of lines) {
    const { text, deadlineRaw } = splitDeadline(line);
    if (!text) return `⚠️ Teks tugas kosong pada baris: "${line}"`;
    let deadline = now.iso;
    if (deadlineRaw) {
      deadline = parseDeadline(deadlineRaw, now.iso);
      if (!deadline) return `⚠️ Tenggat "${deadlineRaw}" tidak dikenali (baris: "${text}"). Coba: besok, jumat, 25/10, +3.\nTidak ada tugas yang disimpan.`;
    }
    parsed.push({ text, deadline });
  }

  const todos = await loadTodos();
  let nextId = todos.reduce((mx, t) => Math.max(mx, t.id), 0) + 1;
  const added = parsed.map((p) => ({
    id: nextId++, kat, tugas: p.text, deadline: p.deadline, status: "Belum", dibuat: now.iso, selesai: "",
  }));
  await appendRows("Todo!A:G", added.map(rowValues));

  return (
    `✅ *${added.length} Tugas Ditambahkan* ${ICON[kat]} ${kat}\n${DIVIDER}\n` +
    added.map((t) => `#${t.id} ${t.tugas}\n   📅 ${fmtFull(t.deadline)}`).join("\n")
  );
}

async function cmdSelesai(rest, now) {
  const ids = parseIds(rest);
  if (!ids.length) return "⚠️ Sebutkan ID tugas.\n_Contoh: todo selesai 3 5_";
  const todos = await loadTodos();
  const ok = [];
  const skip = [];
  for (const id of ids) {
    const t = todos.find((x) => x.id === id);
    if (!t || t.status === "Dihapus") skip.push(`#${id} tidak ditemukan`);
    else if (t.status === "Selesai") skip.push(`#${id} sudah selesai`);
    else ok.push(t);
  }
  await Promise.all(
    ok.map((t) => {
      t.status = "Selesai";
      t.selesai = now.iso;
      return writeRow(t);
    })
  );
  const { overdue, today } = dueSets(todos, now.iso);
  const left = overdue.length + today.length;
  let out = ok.length
    ? `✅ *Selesai!*\n${DIVIDER}\n` + ok.map((t) => `#${t.id} ${t.tugas}`).join("\n")
    : `⚠️ Tidak ada tugas yang diselesaikan.`;
  if (skip.length) out += `\n\n_${skip.join(" · ")}_`;
  if (ok.length) out += `\n\n${left ? `📌 Sisa hari ini + terlambat: *${left}*` : "🎉 Semua tugas hari ini beres!"}`;
  return out;
}

async function cmdBuka(rest) {
  const ids = parseIds(rest);
  if (!ids.length) return "⚠️ Sebutkan ID tugas.\n_Contoh: todo buka 3_";
  const todos = await loadTodos();
  const done = [];
  for (const id of ids) {
    const t = todos.find((x) => x.id === id && x.status !== "Dihapus");
    if (t && t.status === "Selesai") {
      t.status = "Belum";
      t.selesai = "";
      await writeRow(t);
      done.push(t);
    }
  }
  if (!done.length) return "⚠️ Tidak ada tugas selesai dengan ID itu.";
  return `↩️ *Dibuka kembali*\n${DIVIDER}\n` + done.map((t) => `#${t.id} ${t.tugas}`).join("\n");
}

async function cmdEdit(rest, now) {
  const m = rest.match(/^(\d+)\s+(.+)$/);
  if (!m) return "⚠️ Format: ```todo edit <id> <teks baru> | <tenggat>```";
  const id = parseInt(m[1], 10);
  const { text, deadlineRaw } = splitDeadline(m[2]);
  let deadline = null;
  if (deadlineRaw) {
    deadline = parseDeadline(deadlineRaw, now.iso);
    if (!deadline) return `⚠️ Tenggat "${deadlineRaw}" tidak dikenali.`;
  }
  const todos = await loadTodos();
  const t = todos.find((x) => x.id === id && x.status !== "Dihapus");
  if (!t) return `⚠️ Tugas #${id} tidak ditemukan.`;
  if (text) t.tugas = text;
  if (deadline) t.deadline = deadline;
  await writeRow(t);
  return `✏️ *Tugas #${t.id} Diubah*\n${DIVIDER}\n${ICON[t.kat]} ${t.tugas}\n📅 ${fmtFull(t.deadline)}`;
}

async function cmdTunda(rest, now) {
  const m = rest.match(/^(\d+)\s+(.+)$/);
  if (!m) return "⚠️ Format: ```todo tunda <id> <tenggat baru>```";
  const deadline = parseDeadline(m[2], now.iso);
  if (!deadline) return `⚠️ Tenggat "${m[2]}" tidak dikenali. Coba: besok, jumat, 25/10, +3.`;
  const todos = await loadTodos();
  const t = todos.find((x) => x.id === parseInt(m[1], 10) && x.status !== "Dihapus");
  if (!t) return `⚠️ Tugas #${m[1]} tidak ditemukan.`;
  t.deadline = deadline;
  await writeRow(t);
  return `⏭️ *Tugas #${t.id} Dijadwal Ulang*\n${DIVIDER}\n${t.tugas}\n📅 ${fmtFull(t.deadline)}`;
}

async function cmdPindah(rest) {
  const m = rest.match(/^(\d+)\s+(\S+)$/);
  const kat = m ? CAT_ALIAS[m[2].toLowerCase()] : null;
  if (!m || !kat) return "⚠️ Format: ```todo pindah <id> <kerja|kuliah|lain>```";
  const todos = await loadTodos();
  const t = todos.find((x) => x.id === parseInt(m[1], 10) && x.status !== "Dihapus");
  if (!t) return `⚠️ Tugas #${m[1]} tidak ditemukan.`;
  t.kat = kat;
  await writeRow(t);
  return `📂 Tugas #${t.id} dipindah ke ${ICON[kat]} *${kat}*.`;
}

async function cmdHapus(rest) {
  const ids = parseIds(rest);
  if (!ids.length) return "⚠️ Sebutkan ID tugas.\n_Contoh: todo hapus 3_";
  const todos = await loadTodos();
  const gone = [];
  for (const id of ids) {
    const t = todos.find((x) => x.id === id && x.status !== "Dihapus");
    if (t) {
      t.status = "Dihapus";
      await writeRow(t);
      gone.push(t);
    }
  }
  if (!gone.length) return "⚠️ Tidak ada tugas dengan ID itu.";
  return `🗑️ *Dihapus*\n${DIVIDER}\n` + gone.map((t) => `#${t.id} ${t.tugas}`).join("\n") + `\n\n_Baris tetap tersimpan di sheet dengan status Dihapus._`;
}

// ---------- router ----------

const TODO_RE = /^todo\b/i;

function isTodoCommand(text) {
  return TODO_RE.test(text.trim());
}

async function handleTodo(rawText) {
  await ensureTabs();
  const now = wib();
  const lines = rawText.trim().replace(/^todo\b[ \t]*/i, "").split("\n");
  const firstLine = lines[0].trim();
  const extraLines = lines.slice(1);
  const m = firstLine.match(/^(\S+)\s*(.*)$/);
  const verb = m ? m[1].toLowerCase() : "";
  const rest = m ? m[2].trim() : "";

  if (!verb || verb === "hari" || verb === "today") return viewHariIni(await loadTodos(), now);
  if (["semua", "list", "all", "daftar"].includes(verb)) return viewSemua(await loadTodos(), now);
  if (CAT_ALIAS[verb]) return viewSemua(await loadTodos(), now, CAT_ALIAS[verb]);
  if (verb === "riwayat") return viewRiwayat(await loadTodos());

  if (["tambah", "add", "baru"].includes(verb)) return cmdTambah(rest, extraLines, now);
  if (["selesai", "done", "beres"].includes(verb)) return cmdSelesai(rest, now);
  if (["buka", "reopen"].includes(verb)) return cmdBuka(rest);
  if (verb === "edit") return cmdEdit(rest, now);
  if (verb === "tunda") return cmdTunda(rest, now);
  if (verb === "pindah") return cmdPindah(rest);
  if (["hapus", "del", "delete"].includes(verb)) return cmdHapus(rest);

  return usage();
}

// ---------- untuk pengingat pagi ----------

async function collectPagi(now) {
  return dueSets(await loadTodos(), now.iso);
}

module.exports = { isTodoCommand, handleTodo, collectPagi, renderGrouped, CATEGORIES };
