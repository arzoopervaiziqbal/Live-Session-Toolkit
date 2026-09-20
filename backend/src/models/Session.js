const { DataTypes } = require("sequelize");
const sequelize = require("../config/db").sequelize;

const Session = sequelize.define("Session", {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  hostId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: "",
  },
  date: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  status: {
    type: DataTypes.ENUM("draft", "active", "closed"),
    defaultValue: "draft",
  },
}, {
  tableName: "sessions",
  timestamps: true,
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

Session.prototype.toObject = function() {
  return this.toJSON();
};

module.exports = Session;
