const { catat } = require("./kuota");

async function sendMessage(target, message, tipe = "reply") {
  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.FONNTE_TOKEN,
    },
    body: JSON.stringify({ target, message }),
  });

  const result = await response.json();

  // Catat ke tab PesanKeluar untuk memantau kuota. Gagal mencatat tidak boleh menggagalkan balasan.
  if (result && result.status !== false) {
    try {
      await catat(tipe);
    } catch (err) {
      console.error("Gagal mencatat kuota:", err.message);
    }
  }

  return result;
}

module.exports = { sendMessage };
