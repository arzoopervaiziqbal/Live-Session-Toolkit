const crypto = require("crypto");

// Short, URL-friendly, human-shareable code (e.g. "4f9a2b1c")
function generateLinkCode() {
  return crypto.randomBytes(5).toString("hex").slice(0, 8);
}

module.exports = { generateLinkCode };
