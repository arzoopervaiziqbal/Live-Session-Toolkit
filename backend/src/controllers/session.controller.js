const { Op } = require("sequelize");
const Session = require("../models/Session");
const Activity = require("../models/Activity");
const Participant = require("../models/Participant");
const Response = require("../models/Response");

async function createSession(req, res) {
  const { title, description, date, status } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ errors: { title: "Give the session a name." } });
  }
  const session = await Session.create({
    hostId: req.user.id,
    title: title.trim(),
    description: description || "",
    date: date ? new Date(date) : new Date(),
    status: status && ["draft", "active", "closed"].includes(status) ? status : "draft",
  });
  res.status(201).json({ session });
}

async function listSessions(req, res) {
  const sessions = await Session.findAll({
    where: { hostId: req.user.id },
    order: [["createdAt", "DESC"]],
  });
  const withCounts = await Promise.all(
    sessions.map(async (s) => {
      const activities = await Activity.findAll({
        where: { sessionId: s._id },
        attributes: ["_id", "linkId", "status", "questions"],
        order: [["createdAt", "DESC"]],
      });
      const firstActivity = activities[0];
      let participantCount = 0;
      let completedCount = 0;
      if (firstActivity) {
        participantCount = await Participant.count({ where: { activityId: firstActivity._id } });
        const distinctSubmissions = await Response.findAll({
          where: { activityId: firstActivity._id },
          attributes: ["participantId"],
          group: ["participantId"],
        });
        completedCount = distinctSubmissions.length;
      }
      return {
        ...s.toJSON(),
        activityCount: activities.length,
        linkId: firstActivity ? firstActivity.linkId : null,
        activityId: firstActivity ? firstActivity._id : null,
        activityStatus: firstActivity ? firstActivity.status : null,
        participantCount,
        completedCount,
      };
    })
  );
  res.json({ sessions: withCounts });
}

async function getSession(req, res) {
  const session = await Session.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!session) return res.status(404).json({ error: "Session not found." });
  const activities = await Activity.findAll({
    where: { sessionId: session._id },
    order: [["createdAt", "DESC"]],
  });
  res.json({ session, activities });
}

async function updateSession(req, res) {
  const session = await Session.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!session) return res.status(404).json({ error: "Session not found." });

  const { title, description, date, status } = req.body;
  if (title !== undefined) {
    if (!title.trim()) {
      return res.status(400).json({ errors: { title: "Give the session a name." } });
    }
    session.title = title.trim();
  }
  if (description !== undefined) session.description = description;
  if (date !== undefined) session.date = new Date(date);
  if (status !== undefined) {
    if (!["draft", "active", "closed"].includes(status)) {
      return res.status(400).json({ errors: { status: "Invalid status." } });
    }
    session.status = status;
  }

  await session.save();
  res.json({ session });
}

async function deleteSession(req, res) {
  const session = await Session.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!session) return res.status(404).json({ error: "Session not found." });

  const activities = await Activity.findAll({ where: { sessionId: session._id } });
  const activityIds = activities.map((a) => a._id);

  if (activityIds.length > 0) {
    await Response.destroy({ where: { activityId: { [Op.in]: activityIds } } });
    await Participant.destroy({ where: { activityId: { [Op.in]: activityIds } } });
    await Activity.destroy({ where: { _id: { [Op.in]: activityIds } } });
  }

  await session.destroy();
  res.json({ success: true });
}

module.exports = { createSession, listSessions, getSession, updateSession, deleteSession };
