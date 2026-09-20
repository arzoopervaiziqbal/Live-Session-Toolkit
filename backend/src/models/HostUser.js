const { DataTypes } = require("sequelize");
const sequelize = require("../config/db").sequelize;

const HostUser = sequelize.define("HostUser", {
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
  tableName: "host_users",
  timestamps: true,
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

HostUser.prototype.toObject = function() {
  return this.toJSON();
};

module.exports = HostUser;
