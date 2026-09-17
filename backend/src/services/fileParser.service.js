const fs = require("fs/promises");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const SUPPORTED = [".pdf", ".docx", ".txt", ".md"];

// Collapses the ragged whitespace PDF extraction produces, so the model spends
// its context on content rather than blank lines.
function tidy(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === ".pdf") {
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);
      return tidy(data.text);
    }
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      return tidy(result.value);
    }
    if (ext === ".txt" || ext === ".md") {
      return tidy(await fs.readFile(filePath, "utf8"));
    }
  } catch (e) {
    const err = new Error(`Could not read that file (${e.message}). Try a different export.`);
    err.status = 400;
    throw err;
  }

  const err = new Error(`Unsupported file type "${ext}". Upload a PDF, DOCX, TXT, or MD file.`);
  err.status = 400;
  throw err;
}

// Uploads are only needed long enough to pull the text out.
async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    /* already gone — nothing to do */
  }
}

module.exports = { extractTextFromFile, safeUnlink, SUPPORTED };
