import ExcelJS from "exceljs";

function cellToPlainText(cell: ExcelJS.Cell) {
  const value = cell.value;

  if (value == null || value === "") {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }

    if ("text" in value && value.text != null) {
      return String(value.text);
    }

    if ("result" in value && value.result != null) {
      return String(value.result);
    }
  }

  return cell.text ?? "";
}

function worksheetToMatrix(worksheet: ExcelJS.Worksheet | undefined) {
  if (!worksheet) {
    return [];
  }

  const rows: string[][] = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      cells.push(cellToPlainText(row.getCell(column)));
    }

    if (cells.some((cell) => cell.length > 0)) {
      rows.push(cells);
    }
  });

  return rows;
}

export async function readFirstWorksheetMatrix(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );

  return {
    sheetCount: workbook.worksheets.length,
    rows: worksheetToMatrix(workbook.worksheets[0]),
  };
}

export async function writeWorksheetMatrix(
  sheetName: string,
  rows: Array<Array<string>>,
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  for (const row of rows) {
    worksheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
