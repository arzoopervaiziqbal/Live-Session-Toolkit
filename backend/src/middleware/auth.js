const { verifyToken } = require("../utils/jwt");

function requireAuth(expectedRole) {
  return function (req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing authentication token." });

    try {
      const decoded = verifyToken(token);
      if (expectedRole && decoded.role !== expectedRole) {
        return res.status(403).json({ error: "Not authorized for this action." });
      }
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    }
  };
}

module.exports = { requireHost: requireAuth("host"), requireAuth };
