const multer = require("multer");
const path = require("path");
const { SUPPORTED } = require("../services/fileParser.service");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "..", "..", "uploads")),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    const err = new Error(`Unsupported file type. Upload a ${SUPPORTED.join(", ")} file.`);
    err.status = 400;
    return cb(err);
  }
  cb(null, true);
}

module.exports = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });
