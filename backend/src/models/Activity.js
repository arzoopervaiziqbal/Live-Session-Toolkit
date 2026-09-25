const { DataTypes } = require("sequelize");
const sequelize = require("../config/db").sequelize;

const Activity = sequelize.define("Activity", {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  sessionId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  hostId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM("quiz", "poll", "feedback", "qa"),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  difficulty: {
    type: DataTypes.ENUM("easy", "medium", "hard"),
    defaultValue: "medium",
  },
  sourceNotesText: {
    type: DataTypes.TEXT,
    defaultValue: "",
  },
  status: {
    type: DataTypes.ENUM("draft", "published", "closed"),
    defaultValue: "draft",
  },
  linkId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
  },
  questions: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  allowQa: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  qaFeed: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
}, {
  tableName: "activities",
  timestamps: true,
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

Activity.prototype.toObject = function() {
  return this.toJSON();
};

const originalSave = Activity.prototype.save;
Activity.prototype.save = async function(options) {
  this.changed('questions', true);
  return originalSave.call(this, options);
};

module.exports = Activity;
