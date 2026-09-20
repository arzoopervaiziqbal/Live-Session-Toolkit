const { DataTypes } = require("sequelize");
const sequelize = require("../config/db").sequelize;

const Response = sequelize.define("Response", {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  activityId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  participantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  questionId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  answerValue: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: "",
  },
  isCorrect: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: null,
  },
  submittedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: "responses",
  timestamps: true,
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

Response.prototype.toObject = function() {
  return this.toJSON();
};

module.exports = Response;
