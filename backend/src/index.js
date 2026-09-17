const http = require("http");
const env = require("./config/env");
const app = require("./app");
const { connectDB } = require("./config/db");
const realtime = require("./realtime/gateway");

async function start() {
  await connectDB();

  const server = http.createServer(app);
  realtime.init(server);

  server.listen(env.port, () => {
    console.log(`[server] API   -> http://localhost:${env.port}/api`);
    console.log(`[server] WS    -> ws://localhost:${env.port}`);
    console.log(`[server] CORS  -> ${env.clientUrl}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("\n[server] Failed to start:\n  " + err.message + "\n");
  process.exit(1);
});
