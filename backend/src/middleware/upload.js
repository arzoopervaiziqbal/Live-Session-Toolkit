const multer = require("multer");
const path = require("path");

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "..", "..", "uploads")),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error("Unsupported file type. Upload a PDF, DOCX, TXT, or MD file."));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });

module.exports = upload;
