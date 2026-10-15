/**
 * Helper waktu (zona WIB / Asia/Jakarta) dan parser tenggat berbahasa Indonesia.
 * Semua tanggal diwakili string ISO "YYYY-MM-DD".
 */

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const pad = (n) => String(n).padStart(2, "0");

function wib(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const y = parseInt(get("year"), 10);
  const m = parseInt(get("month"), 10);
  const d = parseInt(get("day"), 10);
  return {
    y,
    m,
    d,
    hh: get("hour"),
    mm: get("minute"),
    iso: `${y}-${pad(m)}-${pad(d)}`,
    periode: `${y}-${pad(m)}`,
    dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  };
}

function isoToUtc(iso) {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(y, m - 1, d);
}

function utcToIso(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function addDays(iso, n) {
  return utcToIso(isoToUtc(iso) + n * 86400000);
}

/** Selisih hari: a - b (positif kalau a setelah b). */
function diffDays(a, b) {
  return Math.round((isoToUtc(a) - isoToUtc(b)) / 86400000);
}

function daysInMonth(iso) {
  const [y, m] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dowOf(iso) {
  return new Date(isoToUtc(iso)).getUTCDay();
}

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "15 Okt" */
function fmtShort(iso) {
  if (!iso) return "-";
  const [, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return `${d} ${BULAN_PENDEK[m - 1]}`;
}

/** "15 Okt 2026" */
function fmtMedium(iso) {
  if (!iso) return "-";
  const y = iso.split("-")[0];
  return `${fmtShort(iso)} ${y}`;
}

/** "Rabu, 15 Okt 2026" */
function fmtFull(iso) {
  if (!iso) return "-";
  return `${HARI[dowOf(iso)]}, ${fmtMedium(iso)}`;
}

/** "2026-10" -> "Oktober 2026" */
function periodeLabel(periode) {
  const [y, m] = periode.split("-").map((n) => parseInt(n, 10));
  return `${BULAN[m - 1]} ${y}`;
}

/**
 * Nilai dari sheet -> "YYYY-MM-DD" (atau "" kalau kosong/tidak valid).
 * Menangani string ISO, string dd/mm/yyyy, dan serial number tanggal Google Sheets.
 */
function normDate(v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return utcToIso(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?!\d)/);
  if (m && validDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return "";
}

const NAMA_HARI = {
  minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4,
  jumat: 5, "jum'at": 5, sabtu: 6,
};
const NAMA_BULAN = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

/**
 * Parse tenggat dari teks bebas. Return "YYYY-MM-DD" atau null kalau tidak dikenali.
 *   hari ini | besok | lusa | +3 | minggu depan
 *   senin..minggu (kemunculan berikutnya, bukan hari ini)
 *   15/10 | 15-10 | 15/10/2026 | 2026-10-15 | 15 okt | 15 oktober 2026
 */
function parseDeadline(input, todayIso) {
  const t = (input || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const year = parseInt(todayIso.slice(0, 4), 10);

  if (["hari ini", "hariini", "hr ini", "today", "now"].includes(t)) return todayIso;
  if (["besok", "bsk", "tomorrow"].includes(t)) return addDays(todayIso, 1);
  if (t === "lusa") return addDays(todayIso, 2);
  if (["minggu depan", "pekan depan", "mgg depan"].includes(t)) return addDays(todayIso, 7);

  let m = t.match(/^\+(\d{1,3})$/);
  if (m) return addDays(todayIso, parseInt(m[1], 10));

  if (Object.prototype.hasOwnProperty.call(NAMA_HARI, t)) {
    let delta = (NAMA_HARI[t] - dowOf(todayIso) + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(todayIso, delta);
  }

  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;

  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/);
  if (m) {
    let y = m[3] ? parseInt(m[3], 10) : year;
    if (y < 100) y += 2000;
    return validDate(y, +m[2], +m[1]) ? `${y}-${pad(+m[2])}-${pad(+m[1])}` : null;
  }

  m = t.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/);
  if (m) {
    const mon = NAMA_BULAN[m[2].slice(0, 3)];
    const y = m[3] ? parseInt(m[3], 10) : year;
    if (mon && validDate(y, mon, +m[1])) return `${y}-${pad(mon)}-${pad(+m[1])}`;
  }

  return null;
}

module.exports = {
  BULAN, BULAN_PENDEK, HARI,
  wib, addDays, diffDays, dowOf, daysInMonth,
  fmtShort, fmtMedium, fmtFull, periodeLabel,
  normDate, parseDeadline,
};
