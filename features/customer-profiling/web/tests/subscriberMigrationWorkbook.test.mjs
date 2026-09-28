import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  buildExistingSubscriberWorkbook,
  parseExistingSubscriberWorkbook
} from '../subscriberMigrationWorkbook.js';

const require = createRequire(new URL('../../../../app-shell/web/package.json', import.meta.url));
const ExcelJS = require('exceljs');
const catalog = JSON.parse(await readFile(
  new URL('../../api/customer_profiling/cagayan_isabela_locations.json', import.meta.url),
  'utf8'
));

const citiesByProvince = Object.fromEntries(
  Object.entries(catalog.provinces).map(([province, cities]) => [province, Object.keys(cities)])
);
const barangaysByProvinceCity = Object.fromEntries(
  Object.entries(catalog.provinces).flatMap(([province, cities]) => (
    Object.entries(cities).map(([city, barangays]) => [`${province}::${city}`, barangays])
  ))
);
const template = {
  headers: [
    'firstName', 'lastName', 'contactNumber', 'province', 'city', 'barangay', 'gender',
    'latitude', 'longitude', 'monthlyRate', 'billingMode', 'serviceStartDate', 'serviceStatus',
    'qualifiedPromotionCodes', 'lastPaymentPromotionCode'
  ],
  requiredHeaders: ['firstName', 'lastName', 'contactNumber', 'barangay', 'monthlyRate', 'billingMode', 'serviceStartDate', 'serviceStatus'],
  columnGuide: [
    { column: 'firstName', required: 'Yes', purpose: "Customer's given name.", format: 'Text', example: 'JUAN' },
    { column: 'serviceStartDate', required: 'Yes', purpose: 'Original service activation date.', format: 'YYYY-MM-DD', example: '2024-01-15' }
  ],
  samples: [{
    firstName: 'JUAN', lastName: 'DELA CRUZ', contactNumber: '09171234567',
    province: 'CAGAYAN', city: 'ENRILE', barangay: 'ALIBAGO', gender: 'MALE',
    latitude: '17.559311', longitude: '121.684928', monthlyRate: '1000', billingMode: 'PREPAID',
    serviceStartDate: '2024-01-15', serviceStatus: 'ACTIVE',
    qualifiedPromotionCodes: 'EARLY-BIRD-200', lastPaymentPromotionCode: 'EARLY-BIRD-200'
  }],
  promotions: [{
    id: 'promotion-1', promoCode: 'EARLY-BIRD-200', name: 'Early Bird 200',
    paymentRule: 'EARLY_BIRD', discountType: 'FIXED_AMOUNT', discountAmount: 200,
    billingMode: 'PREPAID', startDate: '2026-01-01', endDate: '', stackable: false
  }],
  allowedValues: {
    province: Object.keys(catalog.provinces),
    citiesByProvince,
    barangaysByProvinceCity,
    gender: ['MALE', 'FEMALE'],
    billingMode: ['PREPAID', 'POSTPAID'],
    serviceStatus: ['ACTIVE', 'SUSPENDED'],
    promotionCode: ['EARLY-BIRD-200']
  },
  notes: []
};

test('Excel template contains dependent location dropdowns and remains uploadable', async () => {
  const workbook = await buildExistingSubscriberWorkbook(template, ExcelJS);
  const subscribers = workbook.getWorksheet('Subscribers');
  const lists = workbook.getWorksheet('_Lists');
  const guide = workbook.getWorksheet('Column Guide');
  const promotions = workbook.getWorksheet('Active Promotions');

  assert.equal(lists.state, 'veryHidden');
  assert.deepEqual(guide.getRow(1).values.slice(1), ['Column', 'Required', 'Purpose', 'Format', 'Example']);
  assert.deepEqual(guide.getRow(3).values.slice(1), ['serviceStartDate', 'Yes', 'Original service activation date.', 'YYYY-MM-DD', '2024-01-15']);
  assert.deepEqual(subscribers.getRow(1).values.slice(1), template.headers);
  assert.deepEqual(promotions.getRow(1).values.slice(1), ['Promo Code', 'Promotion', 'Payment Rule', 'Discount', 'Billing Mode', 'Valid From', 'Valid Until', 'Stackable']);
  assert.equal(promotions.getCell('A2').value, 'EARLY-BIRD-200');
  assert.equal(promotions.getCell('D2').value, 'PHP 200.00');
  assert.equal(subscribers.getCell('D2').dataValidation.formulae[0], 'ProvinceOptions');
  assert.match(subscribers.getCell('E2').dataValidation.formulae[0], /CityRangeMap/);
  assert.match(subscribers.getCell('F2').dataValidation.formulae[0], /BarangayRangeMap/);
  assert.equal(
    subscribers.getCell(2, template.headers.indexOf('lastPaymentPromotionCode') + 1).dataValidation.formulae[0],
    'PromotionCodeOptions'
  );

  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  assert.equal(reloaded.getWorksheet('_Lists').state, 'veryHidden');
  assert.match(reloaded.getWorksheet('Subscribers').getCell('E2').dataValidation.formulae[0], /CityRangeMap/);
  assert.match(reloaded.getWorksheet('Subscribers').getCell('F2').dataValidation.formulae[0], /BarangayRangeMap/);
  assert.equal(reloaded.getWorksheet('Active Promotions').getCell('A2').value, 'EARLY-BIRD-200');
  const parsed = await parseExistingSubscriberWorkbook(buffer, template.requiredHeaders, ExcelJS);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].province, 'CAGAYAN');
  assert.equal(parsed.rows[0].city, 'ENRILE');
  assert.equal(parsed.rows[0].barangay, 'ALIBAGO');
  assert.equal(parsed.rows[0].latitude, '17.559311');
  assert.equal(parsed.rows[0].longitude, '121.684928');
  assert.equal(parsed.rows[0].qualifiedPromotionCodes, 'EARLY-BIRD-200');
  assert.equal(parsed.rows[0].lastPaymentPromotionCode, 'EARLY-BIRD-200');
});
