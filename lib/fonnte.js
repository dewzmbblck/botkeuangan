async function sendMessage(target, message) {
  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.FONNTE_TOKEN,
    },
    body: JSON.stringify({ target, message }),
  });

  return response.json();
}

module.exports = { sendMessage };
