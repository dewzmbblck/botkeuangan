const { getRows, appendRows, setRange, ensureTabs } = require("./gsheets");
const { loadAccounts } = require("./accounts");
const ledger = require("./ledger");
const { formatRupiah } = require("./parser");
const { wib, fmtShort, fmtMedium, periodeLabel, normDate, addDays, diffDays, daysInMonth } = require("./time");

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

/**
 * PLANNER BULANAN
 *
 * Tab:
 *  PlannerTemplate : daftar tetap yang disalin ke tiap bulan baru
 *                    Item | Nominal | Jenis (Bayar/Pisah) | JatuhTempo (tgl 1-31) | Rekening | RekeningTujuan | Aktif
 *  PlannerGaji     : tiap gaji yang masuk  (Periode | Tanggal | Nominal | Rekening | Catatan)
 *  Planner         : satu baris per item per bulan
 *                    A Periode | B Item | C Nominal | D Jenis | E JatuhTempo | F Status | G TanggalSelesai
 *                    H Rekening | I RekeningTujuan | J Terealisasi | K Catatan
 *  Status          : Belum | Terbayar | Terpisah | Dibatalkan
 *  Terealisasi     : nominal yang benar-benar menggerakkan saldo rekening (0 = hanya ditandai)
 *
 * Perintah:
 *   gaji <nominal> [rekening]
 *   lunas <item|no> [nominal] [dari <rekening>]
 *   pisah <item|no> [nominal] [dari <rekening> ke <rekening>]
 *   sisa (= plan sisa) -> estimasi sisa uang
 *   plan | plan item | plan item tambah ... | plan item hapus <nama> | plan batal <item|no>
 */

// ---------- util ----------

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

function toNum(v) {
  if (typeof v === "number") return v;
  const n = parseInt(str(v).replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function amountOf(raw) {
  const n = parseInt(String(raw || "").replace(/[.,]/g, ""), 10);
  return isNaN(n) ? null : n;
}

// ---------- baca / tulis sheet ----------

async function loadTemplate() {
  const rows = await getRows("PlannerTemplate!A2:G");
  return rows
    .map((r, i) => ({
      row: i + 2,
      item: str(r[0]),
      nominal: toNum(r[1]),
      jenis: /pisah/i.test(str(r[2])) ? "Pisah" : "Bayar",
      jatuh: toNum(r[3]) || null,
      rek: str(r[4]),
      rekTujuan: str(r[5]),
      aktif: str(r[6]).toLowerCase() !== "tidak",
    }))
    .filter((t) => t.item);
}

async function loadPlan(periode) {
  const rows = await getRows("Planner!A2:K");
  return rows
    .map((r, i) => ({
      row: i + 2,
      periode: str(r[0]),
      item: str(r[1]),
      nominal: toNum(r[2]),
      jenis: /pisah/i.test(str(r[3])) ? "Pisah" : "Bayar",
      jatuh: toNum(r[4]) || null,
      status: str(r[5]) || "Belum",
      tanggal: normDate(r[6]),
      rek: str(r[7]),
      rekTujuan: str(r[8]),
      real: toNum(r[9]),
      catatan: str(r[10]),
    }))
    .filter((p) => p.item && p.periode === periode);
}

async function loadGaji(periode) {
  const rows = await getRows("PlannerGaji!A2:E");
  return rows.filter((r) => str(r[0]) === periode).reduce((sum, r) => sum + toNum(r[2]), 0);
}

function planRowValues(p) {
  return [
    p.periode, p.item, p.nominal, p.jenis, p.jatuh || "", p.status,
    p.tanggal || "", p.rek || "", p.rekTujuan || "", p.real || 0, p.catatan || "",
  ];
}

async function writePlanRow(p) {
  await setRange(`Planner!A${p.row}:K${p.row}`, [planRowValues(p)]);
}

const activeOf = (list) => list.filter((p) => p.status !== "Dibatalkan");

// ---------- cari item ----------

/** Cari berdasarkan nomor (dari checklist) atau nama (persis / unik sebagian). */
function findItem(query, list, nameOf) {
  const q = str(query).toLowerCase();
  if (!q) return { notFound: true };
  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10);
    if (n >= 1 && n <= list.length) return { found: list[n - 1], index: n };
  }
  const exact = list.filter((x) => nameOf(x).toLowerCase() === q);
  if (exact.length === 1) return { found: exact[0], index: list.indexOf(exact[0]) + 1 };
  const partial = list.filter((x) => nameOf(x).toLowerCase().includes(q));
  if (partial.length === 1) return { found: partial[0], index: list.indexOf(partial[0]) + 1 };
  if (partial.length > 1) return { ambiguous: partial };
  return { notFound: true };
}

function findReply(result, query, list, nameOf) {
  if (result.ambiguous) {
    const lines = result.ambiguous.map((x) => `• ${list.indexOf(x) + 1}. ${nameOf(x)}`).join("\n");
    return `⚠️ *Ada Beberapa Item Cocok*\n${DIVIDER}\nSebut lebih spesifik atau pakai nomor:\n${lines}`;
  }
  return `⚠️ Item "${query}" tidak ditemukan. Ketik *plan* untuk lihat daftar.`;
}

// ---------- tampilan ----------

function summarize(list, gajiTotal) {
  const act = activeOf(list);
  const alokasi = act.reduce((s, p) => s + p.nominal, 0);
  const done = act.filter((p) => p.status === "Terbayar" || p.status === "Terpisah");
  const belum = act.filter((p) => p.status === "Belum");
  return {
    act,
    alokasi,
    sisa: gajiTotal - alokasi,
    doneCount: done.length,
    belumNominal: belum.reduce((s, p) => s + p.nominal, 0),
  };
}

function renderChecklist(periode, gajiTotal, list, now) {
  const sm = summarize(list, gajiTotal);
  const header = `📅 *PLANNER ${periodeLabel(periode).toUpperCase()}*\n${DIVIDER}\n`;

  if (!sm.act.length) {
    return (
      header +
      `💰 Gaji: *${formatRupiah(gajiTotal)}*\n\n` +
      `_Belum ada item. Tambah dengan:_\n` +
      "```plan item tambah <nama> <nominal> <bayar|pisah> [tgl]```"
    );
  }

  const lines = sm.act.map((p, i) => {
    const no = i + 1;
    const nom = formatRupiah(p.nominal);
    if (p.status === "Terbayar") return `${no}. ✅ ${p.item} — ${nom} _(lunas ${fmtShort(p.tanggal)})_`;
    if (p.status === "Terpisah") return `${no}. 🔒 ${p.item} — ${nom} _(terpisah ${fmtShort(p.tanggal)})_`;
    const tag = p.jenis === "Pisah" ? "pisahkan" : "bayar";
    let due = "";
    let icon = "⏳";
    if (p.jatuh) {
      const lewat = now && periode === now.periode && p.jatuh < now.d;
      if (lewat) icon = "⚠️";
      due = ` _(${tag} tgl ${p.jatuh}${lewat ? ", lewat" : ""})_`;
    } else {
      due = ` _(${tag})_`;
    }
    return `${no}. ${icon} ${p.item} — ${nom}${due}`;
  });

  const sisaIcon = sm.sisa < 0 ? "🔴" : "🟢";
  return (
    header +
    lines.join("\n") +
    `\n\n${DIVIDER}\n` +
    `💰 Gaji: ${formatRupiah(gajiTotal)}\n` +
    `📋 Alokasi: ${formatRupiah(sm.alokasi)}\n` +
    `${sisaIcon} Sisa bebas: *${formatRupiah(sm.sisa)}*\n` +
    `✔️ Selesai ${sm.doneCount}/${sm.act.length} · belum: ${formatRupiah(sm.belumNominal)}` +
    (sm.sisa < 0 ? "\n⚠️ _Alokasi melebihi gaji!_" : "")
  );
}

function progressLine(list, gajiTotal) {
  const sm = summarize(list, gajiTotal);
  return `✔️ Selesai ${sm.doneCount}/${sm.act.length} · Sisa bebas: ${formatRupiah(sm.sisa)}`;
}

// ---------- perintah: gaji ----------

async function cmdGaji(text, sender) {
  const m = text.match(/^gaji\s+([\d.,]+)(?:\s+(\S+))?\s*$/i);
  if (!m) {
    return (
      `❓ Format gaji:\n` +
      "```gaji <nominal> [rekening]```\n" +
      `_Contoh: gaji 2900000 bca-saya_\n` +
      `_Tanpa rekening = hanya dicatat di planner, saldo tidak berubah._`
    );
  }
  const amount = amountOf(m[1]);
  if (!amount || amount <= 0) return "⚠️ Nominal gaji tidak valid.";

  await ensureTabs();
  const now = wib();

  // Validasi rekening dulu sebelum menulis apa pun
  let accounts = null;
  let acc = null;
  if (m[2]) {
    accounts = await loadAccounts();
    const r = ledger.resolveSendiri(m[2], accounts);
    if (r.error) return r.error;
    acc = r.acc;
  }

  const existing = await loadPlan(now.periode);
  const isFirst = existing.length === 0;

  await appendRows("PlannerGaji!A:E", [[now.periode, now.iso, amount, acc ? acc.id : "", "Gaji"]]);

  let list = existing;
  if (isFirst) {
    const tpl = (await loadTemplate()).filter((t) => t.aktif);
    list = tpl.map((t) => ({
      row: 0,
      periode: now.periode,
      item: t.item,
      nominal: t.nominal,
      jenis: t.jenis,
      jatuh: t.jatuh,
      status: "Belum",
      tanggal: "",
      rek: t.rek,
      rekTujuan: t.rekTujuan,
      real: 0,
      catatan: "",
    }));
    await appendRows("Planner!A:K", list.map(planRowValues));
  }

  let saldoLine = "ℹ️ _Tanpa rekening — saldo rekening tidak berubah._";
  if (acc) {
    const newSaldo = await ledger.postMasuk(acc, amount, `Gaji ${periodeLabel(now.periode)}`, sender);
    await ledger.syncDashboard(accounts);
    saldoLine = `🏦 ${ledger.accountLabel(acc)}\n💰 Saldo sekarang: *${formatRupiah(newSaldo)}*`;
  }

  const gajiTotal = await loadGaji(now.periode);
  const head =
    `✅ *${isFirst ? "Gaji Tercatat" : "Gaji Tambahan Tercatat"}*\n${DIVIDER}\n` +
    `📥 +${formatRupiah(amount)}\n${saldoLine}\n\n`;

  // Setelah append baris Planner baru, nomor row belum diketahui tapi tidak dibutuhkan untuk tampilan.
  return head + renderChecklist(now.periode, gajiTotal, list, now);
}

// ---------- perintah: lunas / pisah ----------

async function cmdMark(text, sender) {
  const m = text.match(
    /^(lunas|pisah)\s+(.+?)(?:\s+([\d.,]+))?(?:\s+dari\s+(\S+))?(?:\s+ke\s+(\S+))?\s*$/i
  );
  if (!m) {
    return (
      `❓ Format:\n` +
      "```lunas <item|no> [nominal] [dari <rekening>]```\n" +
      "```pisah <item|no> [nominal] [dari <rek> ke <rek>]```\n" +
      `_Contoh: lunas listrik dari bca-saya_\n` +
      `_Contoh: pisah 2 dari bca-saya ke jago-saya_`
    );
  }
  const verb = m[1].toLowerCase();
  let nameRaw = m[2];
  let nomRaw = m[3];
  const dari = m[4];
  const ke = m[5];

  // angka kecil (<1000) di akhir nama dianggap bagian nama item, bukan nominal ("kos 2")
  if (nomRaw && amountOf(nomRaw) < 1000) {
    nameRaw = `${nameRaw} ${nomRaw}`;
    nomRaw = undefined;
  }

  await ensureTabs();
  const now = wib();
  const list = activeOf(await loadPlan(now.periode));
  if (!list.length) {
    return "⚠️ Belum ada rencana bulan ini. Catat gaji dulu: ```gaji <nominal> [rekening]```";
  }

  const nameOf = (p) => p.item;
  const f = findItem(nameRaw, list, nameOf);
  if (!f.found) return findReply(f, nameRaw, list, nameOf);
  const p = f.found;

  if (p.status === "Terbayar" || p.status === "Terpisah") {
    return `ℹ️ *${p.item}* sudah ${p.status.toLowerCase()} pada ${fmtMedium(p.tanggal)}.\nKetik \`plan batal ${f.index}\` kalau salah catat.`;
  }

  const target = verb === "lunas" ? "Terbayar" : "Terpisah";
  const nominal = nomRaw ? amountOf(nomRaw) : p.nominal;
  if (!nominal || nominal <= 0) return "⚠️ Nominal tidak valid.";

  const rekA = dari || p.rek;
  const rekB = verb === "pisah" ? ke || p.rekTujuan : "";
  const doLedger = verb === "lunas" ? !!rekA : !!rekA && !!rekB;

  let accounts = null;
  let accA = null;
  let accB = null;
  if (doLedger) {
    accounts = await loadAccounts();
    const ra = ledger.resolveSendiri(rekA, accounts);
    if (ra.error) return ra.error;
    accA = ra.acc;
    if (rekB) {
      const rb = ledger.resolveSendiri(rekB, accounts);
      if (rb.error) return rb.error;
      accB = rb.acc;
      if (accA.id === accB.id) return "⚠️ Rekening asal dan tujuan tidak boleh sama.";
    }
  }

  const next = {
    ...p,
    status: target,
    tanggal: now.iso,
    nominal,
    rek: accA ? accA.id : p.rek,
    rekTujuan: accB ? accB.id : p.rekTujuan,
    real: doLedger ? nominal : 0,
  };

  // Tandai di sheet dulu; kalau mutasi saldo gagal, kembalikan tandanya.
  await writePlanRow(next);
  let saldoLine = "";
  try {
    const notes = `Planner: ${p.item} (${periodeLabel(now.periode)})`;
    if (doLedger && verb === "lunas") {
      const saldo = await ledger.postKeluar(accA, nominal, notes, sender);
      saldoLine = `💸 -${formatRupiah(nominal)} dari ${ledger.accountLabel(accA)}\n💰 Saldo sekarang: *${formatRupiah(saldo)}*`;
    } else if (doLedger) {
      const s = await ledger.postTransfer(accA, accB, nominal, notes, sender);
      saldoLine =
        `🔒 ${formatRupiah(nominal)} dipisah\n` +
        `${accA.id} → ${accB.id}\n` +
        `💰 ${accA.id}: ${formatRupiah(s.saldoAsal)} · ${accB.id}: ${formatRupiah(s.saldoTujuan)}`;
    }
    if (doLedger) await ledger.syncDashboard(accounts);
  } catch (err) {
    await writePlanRow(p).catch(() => {});
    throw err;
  }

  if (!doLedger) {
    saldoLine =
      verb === "lunas"
        ? `ℹ️ _Tidak ada rekening terhubung — saldo tidak berubah. Tambahkan "dari <rekening>" untuk memotong saldo._`
        : `ℹ️ _Hanya ditandai — saldo tidak berubah. Tambahkan "dari <rek> ke <rek>" untuk memindahkan uangnya._`;
  }

  const newList = list.map((x) => (x.row === p.row ? next : x));
  const gajiTotal = await loadGaji(now.periode);
  return (
    `✅ *${target === "Terbayar" ? "Terbayar" : "Terpisah"}* — ${p.item}\n${DIVIDER}\n` +
    `${saldoLine}\n📅 ${fmtMedium(now.iso)}\n\n${progressLine(newList, gajiTotal)}`
  );
}

// ---------- perintah: plan ... ----------

async function cmdStatus() {
  await ensureTabs();
  const now = wib();
  const list = await loadPlan(now.periode);
  if (!list.length) {
    return `📅 Belum ada rencana untuk ${periodeLabel(now.periode)}.\nMulai dengan: \`gaji <nominal> [rekening]\``;
  }
  const gajiTotal = await loadGaji(now.periode);
  return renderChecklist(now.periode, gajiTotal, list, now);
}

async function cmdTemplateList() {
  await ensureTabs();
  const tpl = (await loadTemplate()).filter((t) => t.aktif);
  if (!tpl.length) {
    return (
      `📑 Template masih kosong.\n` +
      "```plan item tambah <nama> <nominal> <bayar|pisah> [tgl] [dari <rek>] [ke <rek>]```\n" +
      `_Contoh: plan item tambah Listrik 250000 bayar 10 dari bca-saya_\n` +
      `_Contoh: plan item tambah Tabungan 500000 pisah 25 dari bca-saya ke jago-saya_`
    );
  }
  const lines = tpl.map((t, i) => {
    const parts = [t.jenis.toLowerCase()];
    if (t.jatuh) parts.push(`tgl ${t.jatuh}`);
    if (t.rek) parts.push(`dari ${t.rek}`);
    if (t.rekTujuan) parts.push(`ke ${t.rekTujuan}`);
    return `${i + 1}. ${t.item} — ${formatRupiah(t.nominal)} _(${parts.join(" · ")})_`;
  });
  return `📑 *TEMPLATE BULANAN*\n${DIVIDER}\n${lines.join("\n")}\n\n_Disalin otomatis saat kamu catat gaji tiap bulan baru._`;
}

async function cmdTemplateAdd(m) {
  const [, name, nomRaw, jenisRaw, tgl, dari, ke] = m;
  const nominal = amountOf(nomRaw);
  if (!nominal || nominal <= 0) return "⚠️ Nominal tidak valid.";
  const jatuh = tgl ? parseInt(tgl, 10) : null;
  if (jatuh !== null && (jatuh < 1 || jatuh > 31)) return "⚠️ Tanggal jatuh tempo harus 1-31.";
  const jenis = /pisah/i.test(jenisRaw) ? "Pisah" : "Bayar";

  await ensureTabs();
  const now = wib();
  const tpl = (await loadTemplate()).filter((t) => t.aktif);
  if (tpl.some((t) => t.item.toLowerCase() === name.trim().toLowerCase())) {
    return `⚠️ Item "${name}" sudah ada di template.`;
  }

  await appendRows("PlannerTemplate!A:G", [[name.trim(), nominal, jenis, jatuh || "", dari || "", ke || "", "Ya"]]);

  // Kalau bulan ini sudah berjalan, langsung masuk ke planner bulan ini juga
  let extra = "";
  const cur = await loadPlan(now.periode);
  if (cur.length || (await loadGaji(now.periode)) > 0) {
    await appendRows("Planner!A:K", [
      planRowValues({
        periode: now.periode, item: name.trim(), nominal, jenis, jatuh,
        status: "Belum", tanggal: "", rek: dari || "", rekTujuan: ke || "", real: 0, catatan: "",
      }),
    ]);
    extra = `\n📌 Sekaligus ditambahkan ke planner ${periodeLabel(now.periode)}.`;
  }
  return `✅ *Item Template Ditambahkan*\n${DIVIDER}\n${name.trim()} — ${formatRupiah(nominal)} (${jenis.toLowerCase()}${jatuh ? `, tgl ${jatuh}` : ""})${extra}`;
}

async function cmdTemplateRemove(query) {
  await ensureTabs();
  const now = wib();
  const tpl = (await loadTemplate()).filter((t) => t.aktif);
  const nameOf = (t) => t.item;
  const f = findItem(query, tpl, nameOf);
  if (!f.found) return findReply(f, query, tpl, nameOf);
  const t = f.found;

  await setRange(`PlannerTemplate!G${t.row}`, [["Tidak"]]);

  // Baris bulan ini yang belum diproses ikut dibatalkan; yang sudah selesai dibiarkan sebagai riwayat
  const cur = await loadPlan(now.periode);
  const same = cur.filter((p) => p.item.toLowerCase() === t.item.toLowerCase() && p.status === "Belum");
  for (const p of same) {
    await setRange(`Planner!F${p.row}`, [["Dibatalkan"]]);
  }
  return `🗑️ *${t.item}* dinonaktifkan dari template${same.length ? " dan dibatalkan dari planner bulan ini" : ""}.\n_Datanya tetap ada di sheet._`;
}

async function cmdBatal(query, sender) {
  await ensureTabs();
  const now = wib();
  const list = activeOf(await loadPlan(now.periode));
  const nameOf = (p) => p.item;
  const f = findItem(query, list, nameOf);
  if (!f.found) return findReply(f, query, list, nameOf);
  const p = f.found;

  if (p.status === "Belum") return `ℹ️ *${p.item}* memang masih berstatus Belum.`;

  const reset = { ...p, status: "Belum", tanggal: "", real: 0 };
  await writePlanRow(reset);

  let saldoLine = "ℹ️ _Saldo rekening tidak diubah (dulu hanya ditandai)._";
  if (p.real > 0 && p.rek) {
    try {
      const accounts = await loadAccounts();
      const ra = ledger.resolveSendiri(p.rek, accounts);
      if (ra.error) throw new Error(`Rekening ${p.rek} tidak ditemukan untuk pembalikan saldo`);
      const notes = `Batal planner: ${p.item} (${periodeLabel(now.periode)})`;
      if (p.status === "Terbayar") {
        const saldo = await ledger.postMasuk(ra.acc, p.real, notes, sender);
        saldoLine = `↩️ +${formatRupiah(p.real)} dikembalikan ke ${ledger.accountLabel(ra.acc)}\n💰 Saldo sekarang: *${formatRupiah(saldo)}*`;
      } else if (p.rekTujuan) {
        const rb = ledger.resolveSendiri(p.rekTujuan, accounts);
        if (rb.error) throw new Error(`Rekening ${p.rekTujuan} tidak ditemukan untuk pembalikan saldo`);
        await ledger.postTransfer(rb.acc, ra.acc, p.real, notes, sender);
        saldoLine = `↩️ ${formatRupiah(p.real)} dikembalikan ${rb.acc.id} → ${ra.acc.id}`;
      }
      await ledger.syncDashboard(accounts);
    } catch (err) {
      await writePlanRow(p).catch(() => {});
      throw err;
    }
  }
  return `↩️ *Dibatalkan* — ${p.item}\n${DIVIDER}\n${saldoLine}\nStatus kembali ke *Belum*.`;
}

// ---------- perintah: sisa / estimasi ----------

/**
 * Pengeluaran bebas = baris Log "Uang Keluar" yang BUKAN dari planner (Via != Planner),
 * dari tanggal gaji pertama bulan ini sampai hari ini. Item planner yang dibayar lewat
 * `lunas` sudah dihitung di alokasi, jadi tidak dihitung dua kali.
 */
async function loadPengeluaranBebas(fromIso, toIso) {
  const rows = await getRows("Log!A2:I");
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (str(r[1]) !== "Uang Keluar" || str(r[6]).toLowerCase() === "planner") continue;
    const d = normDate(r[0]);
    if (!d || d < fromIso || d > toIso) continue;
    total += toNum(r[4]);
    count++;
  }
  return { total, count };
}

const MIN_HARI_PROYEKSI = 7;

async function cmdSisa() {
  await ensureTabs();
  const now = wib();

  const gajiRows = (await getRows("PlannerGaji!A2:E")).filter((r) => str(r[0]) === now.periode);
  const gajiTotal = gajiRows.reduce((sum, r) => sum + toNum(r[2]), 0);
  if (!gajiTotal) {
    return `📈 Belum ada gaji tercatat untuk ${periodeLabel(now.periode)}.\nCatat dulu: \`gaji <nominal> [rekening]\``;
  }
  const dates = gajiRows.map((r) => normDate(r[1])).filter(Boolean).sort();
  const dariTgl = dates[0] && dates[0] <= now.iso ? dates[0] : `${now.periode}-01`;

  const list = await loadPlan(now.periode);
  const sm = summarize(list, gajiTotal);
  const jalan = sm.act.filter((p) => p.status !== "Belum").reduce((s, p) => s + p.nominal, 0);

  const bebas = await loadPengeluaranBebas(dariTgl, now.iso);
  const estimasi = sm.sisa - bebas.total;

  const hariBerjalan = Math.max(diffDays(now.iso, dariTgl) + 1, 1);
  const hariKeDepan = Math.max(daysInMonth(now.iso) - now.d, 0);
  const rataHari = bebas.total / hariBerjalan; // hari tanpa pengeluaran tetap dihitung (nol)
  const proyeksi = Math.round(estimasi - rataHari * hariKeDepan);

  const icon = (n) => (n < 0 ? "🔴" : "🟢");
  const nf = (n) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  let out =
    `📈 *ESTIMASI SISA — ${periodeLabel(now.periode).toUpperCase()}*\n${DIVIDER}\n` +
    `💰 Gaji: ${formatRupiah(gajiTotal)} _(masuk ${fmtShort(dariTgl)})_\n` +
    `📋 Alokasi: ${formatRupiah(sm.alokasi)}\n` +
    `    ✔️ sudah jalan ${formatRupiah(jalan)} · ⏳ belum ${formatRupiah(sm.belumNominal)}\n` +
    `${icon(sm.sisa)} Sisa rencana: ${formatRupiah(sm.sisa)}\n` +
    `🛒 Pengeluaran bebas: ${formatRupiah(bebas.total)} _(${bebas.count} transaksi sejak ${fmtShort(dariTgl)})_\n` +
    `${DIVIDER}\n` +
    `💎 *Estimasi sisa uang: ${formatRupiah(estimasi)}* ${icon(estimasi)}\n`;

  if (estimasi < 0) {
    out += `\n⚠️ _Pengeluaran bebas sudah melewati sisa gaji setelah alokasi._`;
  } else if (hariKeDepan === 0) {
    out += `\n📅 _Hari terakhir bulan ini._`;
  } else if (hariKeDepan < 7) {
    // Kurang dari seminggu: angka per periode tidak berarti, cukup tampilkan sisanya
    out += `\n📅 ${hariKeDepan} hari lagi di bulan ini.`;
  } else {
    const minggu = hariKeDepan / 7;
    out += `\n📅 ${hariKeDepan} hari lagi (±${nf(minggu)} minggu) → budget aman ≈ *${formatRupiah(Math.floor(estimasi / minggu / 1000) * 1000)}/minggu*`;
  }

  if (estimasi >= 0 && hariKeDepan > 0) {
    if (hariBerjalan < MIN_HARI_PROYEKSI) {
      // Data terlalu sedikit; belanja besar sekali di awal akan terbaca sebagai tren
      out += `\n📊 _Rata-rata & proyeksi tampil setelah ${MIN_HARI_PROYEKSI} hari data (sudah ${hariBerjalan})._`;
    } else {
      out +=
        `\n📊 Rata-rata kamu: ${formatRupiah(Math.round(rataHari * 7))}/minggu\n` +
        `🔮 Proyeksi akhir bulan: *${formatRupiah(proyeksi)}* ${icon(proyeksi)}`;
      if (proyeksi < 0 && rataHari > 0) {
        const habis = addDays(now.iso, Math.floor(estimasi / rataHari));
        out += `\n⚠️ _Dengan tren ini, uang bebas habis sekitar ${fmtShort(habis)}._`;
      }
    }
  }
  out += `\n\n_Pengeluaran bebas = perintah \`keluar\` sejak gaji masuk. Bayar item planner pakai \`lunas\` agar tidak terhitung dua kali._`;
  return out;
}

// ---------- router ----------

const PLANNER_RE = /^(gaji|lunas|pisah|plan|sisa|estimasi)\b/i;

function isPlannerCommand(text) {
  return PLANNER_RE.test(text.trim());
}

async function handlePlanner(rawText, sender) {
  const text = rawText.trim();
  const verb = text.match(PLANNER_RE)[1].toLowerCase();

  if (verb === "gaji") return cmdGaji(text, sender);
  if (verb === "lunas" || verb === "pisah") return cmdMark(text, sender);
  if (verb === "sisa" || verb === "estimasi") return cmdSisa();

  // verb === "plan"
  const rest = text.replace(/^plan\b\s*/i, "");
  if (!rest) return cmdStatus();
  if (/^(sisa|estimasi)\s*$/i.test(rest)) return cmdSisa();
  if (/^(item|template)\s*$/i.test(rest)) return cmdTemplateList();

  let m = rest.match(
    /^item\s+tambah\s+(.+?)\s+([\d.,]+)\s+(bayar|pisah)(?:\s+(\d{1,2}))?(?:\s+dari\s+(\S+))?(?:\s+ke\s+(\S+))?\s*$/i
  );
  if (m) return cmdTemplateAdd(m);

  m = rest.match(/^item\s+hapus\s+(.+)$/i);
  if (m) return cmdTemplateRemove(m[1]);

  m = rest.match(/^batal\s+(.+)$/i);
  if (m) return cmdBatal(m[1], sender);

  return (
    `❓ *Perintah Planner*\n${DIVIDER}\n` +
    "```plan``` checklist bulan ini\n" +
    "```plan sisa``` estimasi sisa uang\n" +
    "```plan item``` daftar template\n" +
    "```plan item tambah <nama> <nominal> <bayar|pisah> [tgl] [dari <rek>] [ke <rek>]```\n" +
    "```plan item hapus <nama>```\n" +
    "```plan batal <item|no>```"
  );
}

// ---------- untuk pengingat pagi ----------

/** Item bulan ini yang belum beres dan sudah jatuh tempo (tgl <= hari ini). */
async function collectDue(now) {
  const list = activeOf(await loadPlan(now.periode));
  return list
    .filter((p) => p.status === "Belum" && p.jatuh && p.jatuh <= now.d)
    .map((p) => ({ item: p.item, nominal: p.nominal, jatuh: p.jatuh, jenis: p.jenis, lewat: p.jatuh < now.d }));
}

module.exports = { isPlannerCommand, handlePlanner, collectDue };
