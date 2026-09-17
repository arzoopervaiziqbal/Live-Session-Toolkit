// RFC 4180 escaping. A leading =, +, - or @ is prefixed with a quote so that
// spreadsheet apps treat a participant-supplied string as text rather than a
// formula (CSV injection).
function escapeCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

module.exports = { toCsv, escapeCell };
