const SUBSCRIBER_SHEET_NAME = 'Subscribers';
const LIST_SHEET_NAME = '_Lists';
const PROMOTIONS_SHEET_NAME = 'Active Promotions';
const MAX_TEMPLATE_ROWS = 5001;

async function loadExcelJs(override) {
  if (override) return override;
  const module = await import('exceljs');
  return module.default || module;
}

function columnLetter(columnNumber) {
  let value = columnNumber;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function addDefinedRange(workbook, name, columnNumber, firstRow, lastRow) {
  const letter = columnLetter(columnNumber);
  workbook.definedNames.add(`${LIST_SHEET_NAME}!$${letter}$${firstRow}:$${letter}$${lastRow}`, name);
}

function setListColumn(sheet, columnNumber, heading, values) {
  sheet.getCell(1, columnNumber).value = heading;
  values.forEach((value, index) => {
    sheet.getCell(index + 2, columnNumber).value = value;
  });
}

function listValidation(formula, prompt, allowBlank = true) {
  return {
    type: 'list',
    allowBlank,
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Choose a listed value',
    error: 'Select a value from the dropdown list.',
    showInputMessage: true,
    promptTitle: 'Template selection',
    prompt,
    formulae: [formula]
  };
}

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return String(value.result ?? '').trim();
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return String(value.text ?? '').trim();
  }
  return String(value).trim();
}

function promotionDiscountLabel(promotion) {
  if (promotion.discountType === 'WAIVE') return 'Waive remaining amount';
  if (promotion.discountType === 'PERCENT') return `${Number(promotion.discountPercent || 0)}%`;
  return `PHP ${Number(promotion.discountAmount || 0).toFixed(2)}`;
}

function parsedRowsFromWorksheet(worksheet, requiredHeaders) {
  const headerRow = worksheet.getRow(1);
  const lastHeaderColumn = headerRow.cellCount;
  const headers = [];
  for (let column = 1; column <= lastHeaderColumn; column += 1) {
    headers.push(cellText(headerRow.getCell(column)));
  }
  const headerKeys = headers.map((header) => header.toLowerCase());
  const errors = requiredHeaders
    .filter((header) => !headerKeys.includes(String(header).toLowerCase()))
    .map((header) => `Missing required header: ${header}`);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const source = worksheet.getRow(rowNumber);
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = cellText(source.getCell(index + 1));
    });
    if (Object.values(row).some((value) => value)) rows.push(row);
  }
  if (!rows.length) errors.push('No installed subscriber lines were found.');
  return { rows, errors };
}

export async function buildExistingSubscriberWorkbook(template, excelJsOverride) {
  const ExcelJS = await loadExcelJs(excelJsOverride);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '3JMain ISP Management';
  workbook.created = new Date();

  const instructions = workbook.addWorksheet('Instructions', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  instructions.columns = [{ width: 28 }, { width: 105 }];
  instructions.addRow(['Existing Subscriber Migration', 'How to use this workbook']);
  instructions.addRow(['One row per line', 'Each row in the Subscribers worksheet represents one already-installed internet line.']);
  instructions.addRow(['Column help', 'Open the Column Guide worksheet for each column purpose, required status, format, and example.']);
  instructions.addRow(['Location', 'Choose Province first, then City, then Barangay. Enter latitude and longitude as decimal degrees or degrees, minutes, and seconds (for example 17°31\'31.42"N). The system converts coordinates to decimal degrees and creates its own location ID and location name.']);
  instructions.addRow(['Plan reference', 'Enter the current monthly rate and billing mode. During review, map that rate to a current Service Catalog plan or create a migration-only legacy plan.']);
  instructions.addRow(['Promotions', 'Use codes from Active Promotions. Separate multiple future qualification codes with semicolons. Last Payment Promotion Code identifies the discount actually applied to the historical payment.']);
  instructions.addRow(['Billing schedule', 'Do not supply a billing day or next billing date. The system derives the calendar-month schedule from Billing Mode, the migration effective date, and Last Paid Through Month.']);
  (template.notes || []).forEach((note) => instructions.addRow(['Note', note]));
  instructions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instructions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF206BC4' } };
  instructions.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });

  const columnGuide = workbook.addWorksheet('Column Guide', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  columnGuide.columns = [
    { header: 'Column', key: 'column', width: 30 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Purpose', key: 'purpose', width: 72 },
    { header: 'Format', key: 'format', width: 38 },
    { header: 'Example', key: 'example', width: 42 }
  ];
  (template.columnGuide || []).forEach((item) => columnGuide.addRow(item));
  columnGuide.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnGuide.columns.length }
  };
  columnGuide.getRow(1).height = 28;
  columnGuide.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  columnGuide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF206BC4' } };
  columnGuide.getRow(1).alignment = { vertical: 'middle' };
  columnGuide.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
    }
    row.alignment = { vertical: 'top', wrapText: true };
  });

  const promotionsSheet = workbook.addWorksheet(PROMOTIONS_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  promotionsSheet.columns = [
    { header: 'Promo Code', key: 'promoCode', width: 24 },
    { header: 'Promotion', key: 'name', width: 34 },
    { header: 'Payment Rule', key: 'paymentRule', width: 18 },
    { header: 'Discount', key: 'discount', width: 22 },
    { header: 'Billing Mode', key: 'billingMode', width: 18 },
    { header: 'Valid From', key: 'startDate', width: 16 },
    { header: 'Valid Until', key: 'endDate', width: 16 },
    { header: 'Stackable', key: 'stackable', width: 12 }
  ];
  (template.promotions || []).forEach((promotion) => promotionsSheet.addRow({
    promoCode: promotion.promoCode || '',
    name: promotion.name || '',
    paymentRule: promotion.paymentRule || 'ANY_PAYMENT',
    discount: promotionDiscountLabel(promotion),
    billingMode: promotion.billingMode || 'ALL',
    startDate: promotion.startDate || '',
    endDate: promotion.endDate || 'No end date',
    stackable: promotion.stackable ? 'Yes' : 'No'
  }));
  promotionsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: promotionsSheet.columns.length }
  };
  promotionsSheet.getRow(1).height = 28;
  promotionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  promotionsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF206BC4' } };
  promotionsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } };
    row.alignment = { vertical: 'top', wrapText: true };
  });

  const sheet = workbook.addWorksheet(SUBSCRIBER_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  const headers = template.headers || [];
  sheet.addRow(headers);
  (template.samples || []).forEach((sample) => sheet.addRow(headers.map((header) => sample?.[header] ?? '')));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF206BC4' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  sheet.columns.forEach((column, index) => {
    const header = headers[index] || '';
    column.width = Math.min(28, Math.max(14, header.length + 3));
  });

  const allowed = template.allowedValues || {};
  const provinces = allowed.province || [];
  const citiesByProvince = allowed.citiesByProvince || {};
  const barangaysByProvinceCity = allowed.barangaysByProvinceCity || {};
  const lists = workbook.addWorksheet(LIST_SHEET_NAME);
  lists.state = 'veryHidden';

  setListColumn(lists, 1, 'ProvinceOptions', provinces);
  addDefinedRange(workbook, 'ProvinceOptions', 1, 2, Math.max(2, provinces.length + 1));
  setListColumn(lists, 2, 'GenderOptions', allowed.gender || []);
  addDefinedRange(workbook, 'GenderOptions', 2, 2, Math.max(2, (allowed.gender || []).length + 1));
  setListColumn(lists, 7, 'BillingModeOptions', allowed.billingMode || []);
  addDefinedRange(workbook, 'BillingModeOptions', 7, 2, Math.max(2, (allowed.billingMode || []).length + 1));
  setListColumn(lists, 10, 'ServiceStatusOptions', allowed.serviceStatus || []);
  addDefinedRange(workbook, 'ServiceStatusOptions', 10, 2, Math.max(2, (allowed.serviceStatus || []).length + 1));
  setListColumn(lists, 100, 'PromotionCodeOptions', allowed.promotionCode || []);
  addDefinedRange(workbook, 'PromotionCodeOptions', 100, 2, Math.max(2, (allowed.promotionCode || []).length + 1));

  lists.getCell('C1').value = 'Province';
  lists.getCell('D1').value = 'CityRangeName';
  provinces.forEach((province, index) => {
    const rangeName = `Cities_${index + 1}`;
    const column = 5 + index;
    const cityValues = citiesByProvince[province] || [];
    lists.getCell(index + 2, 3).value = province;
    lists.getCell(index + 2, 4).value = rangeName;
    setListColumn(lists, column, rangeName, cityValues);
    addDefinedRange(workbook, rangeName, column, 2, Math.max(2, cityValues.length + 1));
  });
  workbook.definedNames.add(`${LIST_SHEET_NAME}!$C$2:$D$${Math.max(2, provinces.length + 1)}`, 'CityRangeMap');

  lists.getCell('H1').value = 'ProvinceCity';
  lists.getCell('I1').value = 'BarangayRangeName';
  let barangayMapRow = 2;
  let barangayListColumn = 11;
  provinces.forEach((province) => {
    (citiesByProvince[province] || []).forEach((city) => {
      const key = `${province}::${city}`;
      const rangeName = `Barangays_${barangayMapRow - 1}`;
      const values = barangaysByProvinceCity[key] || [];
      lists.getCell(barangayMapRow, 8).value = `${province}|${city}`;
      lists.getCell(barangayMapRow, 9).value = rangeName;
      setListColumn(lists, barangayListColumn, rangeName, values);
      addDefinedRange(workbook, rangeName, barangayListColumn, 2, Math.max(2, values.length + 1));
      barangayMapRow += 1;
      barangayListColumn += 1;
    });
  });
  workbook.definedNames.add(`${LIST_SHEET_NAME}!$H$2:$I$${Math.max(2, barangayMapRow - 1)}`, 'BarangayRangeMap');

  const headerColumn = (name) => headers.indexOf(name) + 1;
  const provinceColumn = headerColumn('province');
  const cityColumn = headerColumn('city');
  const barangayColumn = headerColumn('barangay');
  const enumRanges = {
    gender: 'GenderOptions',
    billingMode: 'BillingModeOptions',
    serviceStatus: 'ServiceStatusOptions',
    lastPaymentPromotionCode: 'PromotionCodeOptions'
  };
  for (let rowNumber = 2; rowNumber <= MAX_TEMPLATE_ROWS; rowNumber += 1) {
    if (provinceColumn > 0) {
      sheet.getCell(rowNumber, provinceColumn).dataValidation = listValidation('ProvinceOptions', 'Choose CAGAYAN or ISABELA.', false);
    }
    if (cityColumn > 0 && provinceColumn > 0) {
      sheet.getCell(rowNumber, cityColumn).dataValidation = listValidation(
        `INDIRECT(VLOOKUP($${columnLetter(provinceColumn)}${rowNumber},CityRangeMap,2,FALSE))`,
        'Choose a city or municipality from the selected province.',
        false
      );
    }
    if (barangayColumn > 0 && provinceColumn > 0 && cityColumn > 0) {
      sheet.getCell(rowNumber, barangayColumn).dataValidation = listValidation(
        `INDIRECT(VLOOKUP($${columnLetter(provinceColumn)}${rowNumber}&"|"&$${columnLetter(cityColumn)}${rowNumber},BarangayRangeMap,2,FALSE))`,
        'Choose a barangay from the selected city or municipality.',
        false
      );
    }
    Object.entries(enumRanges).forEach(([header, rangeName]) => {
      const column = headerColumn(header);
      if (column > 0) sheet.getCell(rowNumber, column).dataValidation = listValidation(rangeName, `Choose ${header} from the list.`);
    });
  }

  return workbook;
}

export async function existingSubscriberWorkbookBuffer(template, excelJsOverride) {
  const workbook = await buildExistingSubscriberWorkbook(template, excelJsOverride);
  return workbook.xlsx.writeBuffer();
}

export async function parseExistingSubscriberWorkbook(file, requiredHeaders = [], excelJsOverride) {
  const ExcelJS = await loadExcelJs(excelJsOverride);
  const workbook = new ExcelJS.Workbook();
  const bytes = file instanceof ArrayBuffer || ArrayBuffer.isView(file)
    ? file
    : await file.arrayBuffer();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.getWorksheet(SUBSCRIBER_SHEET_NAME)
    || workbook.worksheets.find((item) => item.state === 'visible')
    || workbook.worksheets[0];
  if (!worksheet) return { rows: [], errors: ['The Excel workbook has no worksheet.'] };
  return parsedRowsFromWorksheet(worksheet, requiredHeaders);
}

export function isExcelSubscriberFile(file) {
  return String(file?.name || '').toLowerCase().endsWith('.xlsx');
}
