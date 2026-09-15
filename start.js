const { spawn } = require("child_process");
const path = require("path");

const app = path.join(__dirname, "index.js");

console.log("🚀 Starting MC Bot Factory...");
console.log("📦 Node:", process.version);
console.log("📁 App:", app);

const child = spawn(process.execPath, [app], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit"
});

child.on("error", (err) => {
    console.error("❌ Failed to start:", err);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    console.log(`⚠️ Application stopped. code=${code} signal=${signal || "none"}`);
    process.exit(code ?? 1);
});
