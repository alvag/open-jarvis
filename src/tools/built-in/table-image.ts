import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Tool, ToolResult } from "../tool-types.js";

const GENERATED_DIR = tmpdir();

// Register Arial for proper UTF-8 character support (tildes, ñ, etc.)
GlobalFonts.registerFromPath("/System/Library/Fonts/Supplemental/Arial.ttf", "Arial");

const FONT = "Arial";
const PADDING = 20;
const CELL_PAD_X = 14;
const CELL_PAD_Y = 10;
const FONT_SIZE = 14;
const HEADER_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 18;

const COLORS = {
  background: "#ffffff",
  headerBg: "#1a73e8",
  headerText: "#ffffff",
  rowEven: "#ffffff",
  rowOdd: "#f8f9fa",
  text: "#202124",
  border: "#dadce0",
  titleText: "#202124",
  paidCell: "#34a853",
  unpaidCell: "#c53929",
  coloredText: "#ffffff",
};

function parseNumeric(value: string): number {
  const cleaned = value.replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
  return parseFloat(cleaned);
}

export function createTableImageTool(): Tool {
  return {
    definition: {
    name: "table_image",
    description:
      "Generate a PNG image of a data table. Use this to create visual table summaries from spreadsheet data. Returns the file path of the generated image. Supports conditional coloring for payment tracking: green for paid (>= threshold), red for unpaid (< threshold). Do NOT include a totals/summary row — only include individual data rows. Do NOT save or upload the generated image anywhere (no Drive, no local storage) — it is sent directly to the user and discarded.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title displayed above the table",
        },
        headers: {
          type: "string",
          description:
            'JSON array of column header strings, e.g. ["Nombre", "Enero", "Febrero", "Marzo"]',
        },
        rows: {
          type: "string",
          description:
            'JSON array of arrays with row data, e.g. [["Alice", "100", "0", "0"]]',
        },
        color_mode: {
          type: "string",
          description:
            "Cell coloring mode. 'payment' colors numeric data cells green if >= threshold, red if < threshold. 'none' uses default alternating row style.",
          enum: ["none", "payment"],
        },
        data_columns_start: {
          type: "string",
          description:
            "Column index (0-based) where numeric data starts. Columns before this won't be colored. Default: 1 (skip first column which is usually names).",
        },
        threshold: {
          type: "string",
          description:
            "Minimum value to be considered 'paid' (green). Default: 100.",
        },
      },
      required: ["headers", "rows"],
    },
  },

  async execute(args): Promise<ToolResult> {
    try {
      const title = (args.title as string) || "";
      const headers: string[] = JSON.parse(args.headers as string);
      const rawRows: string[][] = JSON.parse(args.rows as string);
      // Auto-remove totals/summary rows
      const rows = rawRows.filter(
        (row) => !row[0]?.toLowerCase().includes("total"),
      );
      const colorMode = (args.color_mode as string) || "none";
      const dataColStart = parseInt((args.data_columns_start as string) || "1", 10);
      const threshold = parseFloat((args.threshold as string) || "100");
      // Auto-detect: exclude "Total" column from coloring
      const lastHeader = headers[headers.length - 1]?.toLowerCase().trim();
      const hasTotal = lastHeader === "total";
      const dataColEnd = hasTotal ? headers.length - 1 : headers.length;

      // Auto-detect: last data column = current month (green/white, not green/red)
      const currentMonthCol = dataColEnd - 1;

      // Measure column widths
      const colCount = headers.length;
      const measureCanvas = createCanvas(1, 1);
      const measureCtx = measureCanvas.getContext("2d");

      const colWidths: number[] = [];
      for (let c = 0; c < colCount; c++) {
        measureCtx.font = `bold ${HEADER_FONT_SIZE}px ${FONT}`;
        let maxW = measureCtx.measureText(headers[c] || "").width;

        measureCtx.font = `bold ${FONT_SIZE}px ${FONT}`;
        for (const row of rows) {
          const cellW = measureCtx.measureText(row[c] || "").width;
          if (cellW > maxW) maxW = cellW;
        }
        colWidths.push(Math.ceil(maxW) + CELL_PAD_X * 2);
      }

      const rowHeight = FONT_SIZE + CELL_PAD_Y * 2;
      const headerHeight = HEADER_FONT_SIZE + CELL_PAD_Y * 2;
      const titleHeight = title ? TITLE_FONT_SIZE + PADDING : 0;

      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const tableHeight = headerHeight + rowHeight * rows.length;

      const canvasW = tableWidth + PADDING * 2;
      const canvasH = tableHeight + PADDING * 2 + titleHeight;

      const canvas = createCanvas(canvasW, canvasH);
      const ctx = canvas.getContext("2d");

      // Background
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, canvasW, canvasH);

      const startX = PADDING;
      let startY = PADDING;

      // Title
      if (title) {
        ctx.fillStyle = COLORS.titleText;
        ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT}`;
        ctx.fillText(title, startX, startY + TITLE_FONT_SIZE);
        startY += titleHeight;
      }

      // Header row
      let x = startX;
      ctx.fillStyle = COLORS.headerBg;
      ctx.fillRect(startX, startY, tableWidth, headerHeight);

      ctx.fillStyle = COLORS.headerText;
      ctx.font = `bold ${HEADER_FONT_SIZE}px ${FONT}`;
      for (let c = 0; c < colCount; c++) {
        ctx.fillText(
          headers[c] || "",
          x + CELL_PAD_X,
          startY + CELL_PAD_Y + HEADER_FONT_SIZE - 2,
        );
        x += colWidths[c];
      }
      startY += headerHeight;

      // Data rows
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const isOdd = r % 2 === 1;

        // Draw each cell individually
        x = startX;
        for (let c = 0; c < colCount; c++) {
          const cellValue = row[c] || "";
          const isDataCol = c >= dataColStart && c < dataColEnd;
          const numValue = parseNumeric(cellValue);
          const isNumeric = !isNaN(numValue);

          // Cell background
          let cellBg: string;
          let cellTextColor: string;
          let cellBold = false;

          if (colorMode === "payment" && isDataCol && isNumeric) {
            const isCurrentMonth = c === currentMonthCol;
            if (isCurrentMonth) {
              // Current month: green if >= threshold, normal white if < threshold
              if (numValue >= threshold) {
                cellBg = COLORS.paidCell;
                cellTextColor = COLORS.coloredText;
                cellBold = true;
              } else {
                cellBg = isOdd ? COLORS.rowOdd : COLORS.rowEven;
                cellTextColor = COLORS.text;
              }
            } else {
              // Past months: green if >= threshold, red if < threshold
              cellBg = numValue >= threshold ? COLORS.paidCell : COLORS.unpaidCell;
              cellTextColor = COLORS.coloredText;
              cellBold = true;
            }
          } else {
            cellBg = isOdd ? COLORS.rowOdd : COLORS.rowEven;
            cellTextColor = COLORS.text;
          }

          ctx.fillStyle = cellBg;
          ctx.fillRect(x, startY, colWidths[c], rowHeight);

          ctx.fillStyle = cellTextColor;
          ctx.font = cellBold ? `bold ${FONT_SIZE}px ${FONT}` : `${FONT_SIZE}px ${FONT}`;

          ctx.fillText(
            cellValue,
            x + CELL_PAD_X,
            startY + CELL_PAD_Y + FONT_SIZE - 2,
          );
          x += colWidths[c];
        }
        startY += rowHeight;
      }

      // Borders
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;

      const tableStartY = PADDING + titleHeight;
      ctx.strokeRect(startX, tableStartY, tableWidth, tableHeight);

      // Column separators
      x = startX;
      for (let c = 0; c < colCount - 1; c++) {
        x += colWidths[c];
        ctx.beginPath();
        ctx.moveTo(x, tableStartY);
        ctx.lineTo(x, tableStartY + tableHeight);
        ctx.stroke();
      }

      // Row separators
      let y = tableStartY + headerHeight;
      for (let r = 0; r < rows.length - 1; r++) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + tableWidth, y);
        ctx.stroke();
        y += rowHeight;
      }

      // Header bottom border (thicker)
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, tableStartY + headerHeight);
      ctx.lineTo(startX + tableWidth, tableStartY + headerHeight);
      ctx.stroke();

      // Save to file
      const fileName = `table_${Date.now()}.png`;
      const filePath = join(GENERATED_DIR, fileName);
      const pngBuffer = canvas.toBuffer("image/png");
      writeFileSync(filePath, pngBuffer);

      return {
        success: true,
        data: {
          imagePath: filePath,
          message: `Table image generated: ${fileName}`,
        },
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: (err as Error).message,
      };
    }
  },
  };
}
