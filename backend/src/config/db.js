const { Sequelize } = require("sequelize");
const env = require("./env");
const path = require("path");

let sequelize;

if (env.databaseUrl && (env.databaseUrl.startsWith("postgres://") || env.databaseUrl.startsWith("postgresql://"))) {
  console.log("[db] Connecting to PostgreSQL / Supabase using DATABASE_URL...");
  sequelize = new Sequelize(env.databaseUrl, {
    dialect: "postgres",
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  });
} else {
  const sqlitePath = path.join(__dirname, "..", "..", "database.sqlite");
  console.log(`[db] No valid PostgreSQL DATABASE_URL specified. Falling back to local SQLite at: ${sqlitePath}`);
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: sqlitePath,
    logging: false,
  });
}

async function connectDB() {
  await sequelize.authenticate();
  console.log(`[db] Connected to SQL database`);
  
  // Register models and relations
  require("../models/HostUser");
  require("../models/ParticipantUser");
  require("../models/Session");
  require("../models/Activity");
  require("../models/Participant");
  require("../models/Response");

  // SQLite doesn't support ALTER COLUMN natively — Sequelize emulates it via a
  // backup-table copy which can fail when existing rows violate constraints.
  // Use alter only on PostgreSQL; for SQLite just create any missing tables.
  const isSqlite = !env.databaseUrl;
  await sequelize.sync({ alter: !isSqlite });
  console.log(`[db] Database tables synced successfully`);
}

module.exports = connectDB;
module.exports.sequelize = sequelize;
