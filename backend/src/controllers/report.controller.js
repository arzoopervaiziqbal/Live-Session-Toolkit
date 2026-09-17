const { ownedSession } = require("./session.controller");
const { buildSessionReport, reportToCsv } = require("../services/report.service");
const { httpError } = require("../middleware/error");

// ---------------------------------------------------------------------------
// Helper: slug + timestamp for filenames
// ---------------------------------------------------------------------------
function fileSlug(session) {
  const slug =
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "session";
  const stamp = new Date().toISOString().slice(0, 10);
  return { slug, stamp };
}

// GET /api/sessions/:id/report
async function getReport(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  const report = await buildSessionReport(session);
  res.json({ report });
}

// GET /api/sessions/:id/report/export?format=csv|json
async function exportReport(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  const format = (req.query.format || "csv").toLowerCase();
  const report = await buildSessionReport(session);
  const { slug, stamp } = fileSlug(session);

  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-report-${stamp}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  }

  if (format !== "csv") throw httpError(400, "Supported formats: csv, json.");

  const csv = "\uFEFF" + reportToCsv(report);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}-report-${stamp}.csv"`);
  res.send(csv);
}

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/report/export/excel
// ---------------------------------------------------------------------------
async function exportExcel(req, res) {
  const ExcelJS = require("exceljs");
  const session = await ownedSession(req.params.id, req.user.id);
  const report = await buildSessionReport(session);
  const { slug, stamp } = fileSlug(session);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Live Session Toolkit";
  wb.created = new Date();

  // ---- Branding colours ----
  const PRIMARY = "FF6C63FF";
  const HEADER_BG = "FF2A2E52";
  const HEADER_FG = "FFFFFFFF";
  const ALT_ROW = "FFF5F5FF";
  const GOLD = "FFFFD700";
  const SILVER = "FFC0C0C0";
  const BRONZE = "FFCD7F32";

  function applyHeaderRow(row, cols) {
    row.values = cols;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_FG }, name: "Calibri", size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: PRIMARY } },
      };
    });
    row.height = 22;
  }

  function rankBadge(rank) {
    if (rank === 1) return "🥇 1";
    if (rank === 2) return "🥈 2";
    if (rank === 3) return "🥉 3";
    return String(rank);
  }

  // ---- Sheet 1: Scoreboard ----
  {
    const ws = wb.addWorksheet("Scoreboard");
    ws.columns = [
      { key: "rank", width: 10 },
      { key: "name", width: 28 },
      { key: "score", width: 14 },
      { key: "possible", width: 12 },
      { key: "pct", width: 12 },
      { key: "correct", width: 12 },
      { key: "attempted", width: 13 },
      { key: "accuracy", width: 12 },
    ];

    // Title block
    ws.mergeCells("A1:H1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `${report.session.title} — Session Report`;
    titleCell.font = { bold: true, size: 14, color: { argb: PRIMARY }, name: "Calibri" };
    titleCell.alignment = { horizontal: "center" };
    ws.getRow(1).height = 28;

    ws.mergeCells("A2:H2");
    ws.getCell("A2").value = `Code: ${report.session.sessionCode}  |  Generated: ${new Date().toLocaleString()}  |  Participants: ${report.summary.participants}  |  Avg Score: ${report.summary.averageScore}/${report.summary.totalPossible}  |  Avg Accuracy: ${report.summary.averageAccuracy}%`;
    ws.getCell("A2").font = { size: 10, color: { argb: "FF555555" }, name: "Calibri" };
    ws.getCell("A2").alignment = { horizontal: "center" };
    ws.getRow(2).height = 16;

    ws.addRow([]); // spacer

    applyHeaderRow(ws.getRow(4), ["Rank", "Name", "Score", "Out of", "%", "Correct", "Attempted", "Accuracy %"]);

    report.scoreboard.forEach((p, i) => {
      const row = ws.addRow([
        rankBadge(p.rank),
        p.name,
        p.score,
        p.totalPossible,
        `${p.percentage}%`,
        p.correct,
        p.attempted,
        `${p.accuracy}%`,
      ]);
      row.height = 18;
      // Alternate row shading
      if (i % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } };
        });
      }
      // Top 3 rank colour
      const rankColor = p.rank === 1 ? GOLD : p.rank === 2 ? SILVER : p.rank === 3 ? BRONZE : null;
      if (rankColor) {
        row.getCell(1).font = { bold: true, color: { argb: rankColor } };
      }
      // Score bold
      row.getCell(3).font = { bold: true };
      row.eachCell((cell) => { cell.alignment = { vertical: "middle", horizontal: "center" }; });
      row.getCell(2).alignment = { horizontal: "left" };
    });

    ws.autoFilter = { from: "A4", to: "H4" };
  }

  // ---- Sheet 2: Question Breakdown ----
  if (report.questionBreakdown.length) {
    const ws = wb.addWorksheet("Questions");
    ws.columns = [
      { key: "num", width: 6 },
      { key: "question", width: 42 },
      { key: "answer", width: 18 },
      { key: "difficulty", width: 12 },
      { key: "responses", width: 12 },
      { key: "correct", width: 10 },
      { key: "incorrect", width: 11 },
      { key: "rate", width: 13 },
      { key: "avgMs", width: 14 },
    ];
    applyHeaderRow(ws.getRow(1), ["#", "Question", "Correct Answer", "Difficulty", "Responses", "Correct", "Incorrect", "Correct Rate %", "Avg Response (s)"]);
    report.questionBreakdown.forEach((qb, i) => {
      const row = ws.addRow([
        qb.number,
        qb.question,
        qb.correctAnswer || "—",
        qb.difficulty || "—",
        qb.responses,
        qb.correct,
        qb.incorrect,
        `${qb.correctRate}%`,
        qb.averageResponseMs != null ? (qb.averageResponseMs / 1000).toFixed(1) : "—",
      ]);
      if (i % 2 === 0) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
      row.eachCell((c) => { c.alignment = { vertical: "middle", wrapText: true }; });
    });
  }

  // ---- Sheet 3: Poll Results ----
  if (report.pollSummary.length) {
    const ws = wb.addWorksheet("Polls");
    ws.columns = [
      { key: "num", width: 6 },
      { key: "question", width: 42 },
      { key: "option", width: 24 },
      { key: "votes", width: 10 },
      { key: "pct", width: 12 },
    ];
    applyHeaderRow(ws.getRow(1), ["#", "Poll Question", "Option", "Votes", "Share %"]);
    let rowIdx = 0;
    report.pollSummary.forEach((poll) => {
      poll.results.forEach((r) => {
        const row = ws.addRow([poll.number, poll.question, r.option, r.count, `${r.percentage}%`]);
        if (rowIdx % 2 === 0) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
        rowIdx++;
      });
    });
  }

  const { slug: xlSlug, stamp: xlStamp } = fileSlug(session);
  const filename = `${xlSlug}-report-${xlStamp}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/report/export/pdf
// ---------------------------------------------------------------------------
async function exportPdf(req, res) {
  const PDFDocument = require("pdfkit");
  const session = await ownedSession(req.params.id, req.user.id);
  const report = await buildSessionReport(session);
  const { slug, stamp } = fileSlug(session);

  const filename = `${slug}-report-${stamp}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 50, size: "A4", info: { Title: `${report.session.title} — Report` } });
  doc.pipe(res);

  const PRIMARY = "#6C63FF";
  const DARK = "#171A33";
  const GRAY = "#6B7280";
  const pageWidth = doc.page.width - 100; // margins

  // ---- Header banner ----
  doc.rect(0, 0, doc.page.width, 90).fill(DARK);
  doc.fontSize(20).fillColor(PRIMARY).font("Helvetica-Bold")
    .text("Live Session Toolkit", 50, 20);
  doc.fontSize(14).fillColor("white").font("Helvetica-Bold")
    .text(report.session.title, 50, 46);
  doc.fontSize(9).fillColor("#9CA3AF").font("Helvetica")
    .text(`Code: ${report.session.sessionCode}  ·  Generated: ${new Date().toLocaleString()}  ·  Status: ${report.session.status}`, 50, 70);

  doc.y = 110;

  // ---- Summary stats ----
  function statBox(x, y, label, value) {
    doc.rect(x, y, 110, 54).strokeColor("#E5E7EB").lineWidth(1).stroke();
    doc.rect(x, y, 110, 5).fill(PRIMARY);
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(label, x + 8, y + 12);
    doc.fontSize(18).fillColor(DARK).font("Helvetica-Bold").text(String(value), x + 8, y + 24);
  }

  statBox(50, doc.y, "PARTICIPANTS", report.summary.participants);
  statBox(170, doc.y, "AVG SCORE", `${report.summary.averageScore}/${report.summary.totalPossible}`);
  statBox(290, doc.y, "AVG ACCURACY", `${report.summary.averageAccuracy}%`);
  statBox(410, doc.y, "QUIZ QUESTIONS", report.summary.quizQuestions);

  doc.y += 80;

  // ---- Section header helper ----
  function sectionHeader(title) {
    doc.moveDown(0.5);
    doc.rect(50, doc.y, pageWidth, 22).fill(DARK);
    doc.fontSize(11).fillColor("white").font("Helvetica-Bold")
      .text(title, 58, doc.y + 5);
    doc.y += 28;
    doc.fillColor(DARK);
  }

  // ---- Table header row ----
  function tableHeader(cols, widths) {
    const startX = 50;
    let x = startX;
    doc.rect(startX, doc.y, pageWidth, 18).fill("#F3F4F6");
    cols.forEach((col, i) => {
      doc.fontSize(8).fillColor(GRAY).font("Helvetica-Bold")
        .text(col, x + 4, doc.y + 4, { width: widths[i] - 8, ellipsis: true });
      x += widths[i];
    });
    doc.y += 20;
    doc.fillColor(DARK);
  }

  // ---- Table data row ----
  function tableRow(values, widths, isAlt, highlight = false) {
    if (doc.y > doc.page.height - 80) { doc.addPage(); doc.y = 50; }
    const startX = 50;
    const rowH = 16;
    if (highlight) doc.rect(startX, doc.y, pageWidth, rowH).fill("#EEF2FF");
    else if (isAlt) doc.rect(startX, doc.y, pageWidth, rowH).fill("#F9FAFB");
    let x = startX;
    values.forEach((val, i) => {
      doc.fontSize(8.5).fillColor(highlight ? PRIMARY : DARK).font("Helvetica")
        .text(String(val ?? "—"), x + 4, doc.y + 3, { width: widths[i] - 8, ellipsis: true });
      x += widths[i];
    });
    doc.rect(startX, doc.y, pageWidth, rowH).strokeColor("#E5E7EB").lineWidth(0.5).stroke();
    doc.y += rowH;
  }

  // ---- Scoreboard ----
  sectionHeader("📊 SCOREBOARD");
  const sbWidths = [45, 155, 55, 55, 50, 55, 55, 55];
  tableHeader(["Rank", "Name", "Score", "Out of", "%", "Correct", "Attempted", "Accuracy"], sbWidths);
  report.scoreboard.forEach((p, i) => {
    const medal = p.rank === 1 ? "🥇" : p.rank === 2 ? "🥈" : p.rank === 3 ? "🥉" : "";
    tableRow(
      [`${medal} #${p.rank}`, p.name, p.score, p.totalPossible, `${p.percentage}%`, p.correct, p.attempted, `${p.accuracy}%`],
      sbWidths,
      i % 2 === 0,
      false
    );
  });

  // ---- Question Breakdown ----
  if (report.questionBreakdown.length) {
    doc.addPage();
    sectionHeader("📋 QUESTION BREAKDOWN");
    const qbWidths = [30, 200, 100, 60, 60, 65];
    tableHeader(["#", "Question", "Answer", "Responses", "Correct", "Correct Rate"], qbWidths);
    report.questionBreakdown.forEach((qb, i) => {
      tableRow(
        [qb.number, qb.question, qb.correctAnswer || "—", qb.responses, qb.correct, `${qb.correctRate}%`],
        qbWidths,
        i % 2 === 0
      );
    });
  }

  // ---- Poll Results ----
  if (report.pollSummary.length) {
    doc.moveDown();
    sectionHeader("📣 POLL RESULTS");
    const pollWidths = [30, 200, 130, 60, 95];
    tableHeader(["#", "Poll Question", "Option", "Votes", "Share %"], pollWidths);
    let rowIdx = 0;
    report.pollSummary.forEach((poll) => {
      poll.results.forEach((r) => {
        tableRow([poll.number, poll.question, r.option, r.count, `${r.percentage}%`], pollWidths, rowIdx % 2 === 0);
        rowIdx++;
      });
    });
  }

  // ---- Footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor(GRAY).font("Helvetica")
      .text(
        `Page ${i + 1} of ${range.count}  ·  Live Session Toolkit  ·  ${report.session.title}`,
        50,
        doc.page.height - 30,
        { align: "center", width: pageWidth }
      );
  }

  doc.end();
}

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/report/export/word
// ---------------------------------------------------------------------------
async function exportWord(req, res) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType } = require("docx");
  const session = await ownedSession(req.params.id, req.user.id);
  const report = await buildSessionReport(session);
  const { slug, stamp } = fileSlug(session);

  const PRIMARY_COLOR = "6C63FF";
  const DARK_COLOR = "171A33";
  const GRAY_COLOR = "6B7280";

  function headerPara(text) {
    return new Paragraph({
      text,
      heading: HeadingLevel.HEADING_2,
      thematicBreak: false,
      spacing: { before: 320, after: 120 },
      run: { color: PRIMARY_COLOR, bold: true },
    });
  }

  function buildTable(headers, rows) {
    const headerRow = new TableRow({
      tableHeader: true,
      children: headers.map((h) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, color: DARK_COLOR },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 18 })],
          })],
        })
      ),
    });

    const dataRows = rows.map((cols, ri) =>
      new TableRow({
        children: cols.map((val) =>
          new TableCell({
            shading: ri % 2 === 0 ? { type: ShadingType.SOLID, color: "F5F5FF" } : undefined,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: String(val ?? "—"), size: 18, color: DARK_COLOR })],
            })],
          })
        ),
      })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }

  // Build document sections
  const children = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: "Live Session Toolkit — Session Report", bold: true, size: 36, color: PRIMARY_COLOR })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: report.session.title, bold: true, size: 28, color: DARK_COLOR })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Code: ${report.session.sessionCode}  ·  `, size: 18, color: GRAY_COLOR }),
        new TextRun({ text: `Status: ${report.session.status}  ·  `, size: 18, color: GRAY_COLOR }),
        new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: GRAY_COLOR }),
      ],
      spacing: { after: 200 },
    }),

    // Summary
    headerPara("📊 Summary"),
    new Paragraph({ children: [new TextRun({ text: `Participants: ${report.summary.participants}`, size: 20 })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Average Score: ${report.summary.averageScore} / ${report.summary.totalPossible}`, size: 20 })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Average Accuracy: ${report.summary.averageAccuracy}%`, size: 20 })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Quiz Questions: ${report.summary.quizQuestions}  ·  Polls: ${report.summary.polls}`, size: 20 })], spacing: { after: 200 } }),

    // Scoreboard table
    headerPara("🏆 Scoreboard"),
    buildTable(
      ["Rank", "Name", "Score", "Out of", "%", "Correct", "Attempted", "Accuracy"],
      report.scoreboard.map((p) => [
        `#${p.rank}`, p.name, p.score, p.totalPossible, `${p.percentage}%`, p.correct, p.attempted, `${p.accuracy}%`,
      ])
    ),
  ];

  // Question Breakdown
  if (report.questionBreakdown.length) {
    children.push(headerPara("📋 Question Breakdown"));
    children.push(buildTable(
      ["#", "Question", "Correct Answer", "Responses", "Correct", "Correct Rate"],
      report.questionBreakdown.map((qb) => [
        qb.number, qb.question, qb.correctAnswer || "—", qb.responses, qb.correct, `${qb.correctRate}%`,
      ])
    ));
  }

  // Poll Results
  if (report.pollSummary.length) {
    children.push(headerPara("📣 Poll Results"));
    const pollRows = [];
    report.pollSummary.forEach((poll) => {
      poll.results.forEach((r) => pollRows.push([poll.number, poll.question, r.option, r.count, `${r.percentage}%`]));
    });
    children.push(buildTable(["#", "Poll Question", "Option", "Votes", "Share %"], pollRows));
  }

  const doc = new Document({
    creator: "Live Session Toolkit",
    title: `${report.session.title} — Report`,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${slug}-report-${stamp}.docx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = { getReport, exportReport, exportExcel, exportPdf, exportWord };
