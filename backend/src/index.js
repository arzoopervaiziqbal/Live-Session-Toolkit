const http = require("http");
const connectDB = require("./config/db");
const env = require("./config/env");
const app = require("./app");
const { initSocket } = require("./socket");

async function start() {
  await connectDB();
  const server = http.createServer(app);
  initSocket(server, env.clientUrl);

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
