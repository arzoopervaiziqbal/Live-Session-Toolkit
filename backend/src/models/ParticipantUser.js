const { DataTypes } = require("sequelize");
const sequelize = require("../config/db").sequelize;

const ParticipantUser = sequelize.define("ParticipantUser", {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: "participant_users",
  timestamps: true,
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

ParticipantUser.prototype.toObject = function() {
  return this.toJSON();
};

module.exports = ParticipantUser;
