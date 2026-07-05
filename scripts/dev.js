const { spawn } = require("child_process");

const next = spawn("npx", ["next", "dev", "--experimental-https"], {
  stdio: "inherit",
  shell: true,
});

const checkNgrok = setInterval(async () => {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    const data = await res.json();
    const url = data.tunnels?.[0]?.public_url;
    if (url) {
      console.log(`\n  \uD83D\uDD17 Ngrok Login: ${url}/login\n`);
      clearInterval(checkNgrok);
    }
  } catch {}
}, 2000);

next.on("close", () => {
  clearInterval(checkNgrok);
  process.exit();
});
