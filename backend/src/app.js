const express = require("express");
const cors = require("cors");
const path = require("path");
const env = require("./config/env");
const { notFound, errorHandler } = require("./middleware/error");

const authRoutes = require("./routes/auth.routes");
const sessionRoutes = require("./routes/session.routes");
const activityRoutes = require("./routes/activity.routes");
const joinRoutes = require("./routes/join.routes");

const app = express();

app.use(cors({ origin: env.clientUrl }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/join", joinRoutes);
app.use("/api", activityRoutes); // /api/sessions/:sessionId/activities, /api/activities/:id/*

app.use(notFound);
app.use(errorHandler);

module.exports = app;
