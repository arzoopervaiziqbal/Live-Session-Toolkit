const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const { notFound, errorHandler } = require("./middleware/error");

const authRoutes = require("./routes/auth.routes");
const sessionRoutes = require("./routes/session.routes");
const activityRoutes = require("./routes/activity.routes");
const joinRoutes = require("./routes/join.routes");
const qaRoutes = require("./routes/qa.routes");

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: env.clientUrl, credentials: false }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.get("/api/health", (req, res) =>
  res.json({ ok: true, serverNow: Date.now(), uptime: Math.round(process.uptime()) })
);

// Clock endpoint for participants that can't hold a websocket — the offline
// queue uses it to timestamp queued answers against server time.
app.get("/api/time", (req, res) => res.json({ serverNow: Date.now() }));

app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/join", joinRoutes);
app.use("/api/qa", qaRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
