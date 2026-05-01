import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerType, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RequestWithContext } from '../common/request-context';
import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';

type SecondaryContact = {
  name: string;
  contactNumber?: string;
  facebookAccount?: string;
  facebookProfileLink?: string;
  relationship?: string;
};

export interface BulkUploadFailure {
  row: number;
  message: string;
}

export interface BulkUploadPreviewRow {
  row: number;
  valid: boolean;
  errors: string[];
  preview: {
    firstName: string;
    lastName: string;
    contactNumber: string;
    email: string;
    province: string;
    city: string;
    barangay: string;
    customerType: string;
  };
}

export interface BulkUploadPreviewResult {
  templateValid: boolean;
  missingHeaders: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: BulkUploadPreviewRow[];
}

interface ParsedUploadFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

interface AnalyzedBulkUpload {
  templateValid: boolean;
  missingHeaders: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: BulkUploadPreviewRow[];
  sourceHeaders: string[];
  validPayloads: Array<{ rowNumber: number; payload: CreateCustomerDto; sourceRow: Record<string, unknown> }>;
  invalidRowsWithSource: Array<{ rowNumber: number; errors: string[]; sourceRow: Record<string, unknown> }>;
}

const PROVINCES = ['CAGAYAN', 'ISABELA'] as const;
const CUSTOMER_TYPES = ['RESIDENTIAL', 'BUSINESS', 'ENTERPRISE'] as const;
const REQUIRED_UPLOAD_HEADERS = [
  'firstName',
  'lastName',
  'contactNumber',
  'facebookAccountName',
  'addressLine1',
  'province',
  'city',
  'barangay',
] as const;

const MUNICIPALITIES = [
  'ABULUG',
  'ALCALA',
  'ALLACAPAN',
  'AMULUNG',
  'APARRI',
  'BAGGAO',
  'BALLESTEROS',
  'BUGUEY',
  'CALAYAN',
  'CAMALANIUGAN',
  'CLAVERIA',
  'ENRILE',
  'GATTARAN',
  'GONZAGA',
  'IGUIG',
  'LAL-LO',
  'LASAM',
  'PAMPLONA',
  'PENABLANCA',
  'PIAT',
  'RIZAL',
  'SANCHEZ-MIRA',
  'SANTA ANA',
  'SANTA PRAXEDES',
  'SANTA TERESITA',
  'SANTO NINO',
  'SOLANA',
  'TUAO',
  'TUGUEGARAO CITY',
  'ALICIA',
  'ANGADANAN',
  'AURORA',
  'BENITO SOLIVEN',
  'BURGOS',
  'CABAGAN',
  'CABATUAN',
  'CAUAYAN CITY',
  'CORDON',
  'DINAPIGUE',
  'DIVILACAN',
  'ECHAGUE',
  'GAMU',
  'ILAGAN CITY',
  'JONES',
  'LUNA',
  'MACONACON',
  'MALLIG',
  'NAGUILIAN',
  'PALANAN',
  'QUEZON',
  'QUIRINO',
  'RAMON',
  'REINA MERCEDES',
  'ROXAS',
  'SAN AGUSTIN',
  'SAN GUILLERMO',
  'SAN ISIDRO',
  'SAN MANUEL',
  'SAN MARIANO',
  'SAN MATEO',
  'SAN PABLO',
  'SANTA MARIA',
  'SANTIAGO CITY',
  'SANTO TOMAS',
  'TUMAUINI',
] as const;

const MUNICIPALITIES_BY_PROVINCE: Record<(typeof PROVINCES)[number], readonly string[]> = {
  CAGAYAN: [
    'ABULUG',
    'ALCALA',
    'ALLACAPAN',
    'AMULUNG',
    'APARRI',
    'BAGGAO',
    'BALLESTEROS',
    'BUGUEY',
    'CALAYAN',
    'CAMALANIUGAN',
    'CLAVERIA',
    'ENRILE',
    'GATTARAN',
    'GONZAGA',
    'IGUIG',
    'LAL-LO',
    'LASAM',
    'PAMPLONA',
    'PENABLANCA',
    'PIAT',
    'RIZAL',
    'SANCHEZ-MIRA',
    'SANTA ANA',
    'SANTA PRAXEDES',
    'SANTA TERESITA',
    'SANTO NINO',
    'SOLANA',
    'TUAO',
    'TUGUEGARAO CITY',
  ],
  ISABELA: [
    'ALICIA',
    'ANGADANAN',
    'AURORA',
    'BENITO SOLIVEN',
    'BURGOS',
    'CABAGAN',
    'CABATUAN',
    'CAUAYAN CITY',
    'CORDON',
    'DINAPIGUE',
    'DIVILACAN',
    'ECHAGUE',
    'GAMU',
    'ILAGAN CITY',
    'JONES',
    'LUNA',
    'MACONACON',
    'MALLIG',
    'NAGUILIAN',
    'PALANAN',
    'QUEZON',
    'QUIRINO',
    'RAMON',
    'REINA MERCEDES',
    'ROXAS',
    'SAN AGUSTIN',
    'SAN GUILLERMO',
    'SAN ISIDRO',
    'SAN MANUEL',
    'SAN MARIANO',
    'SAN MATEO',
    'SAN PABLO',
    'SANTA MARIA',
    'SANTIAGO CITY',
    'SANTO TOMAS',
    'TUMAUINI',
  ],
};

const BARANGAYS = [
  'ALIBAGO',
  'BARANGAY I',
  'BARANGAY II',
  'BARANGAY III',
  'BARANGAY III-A',
  'BARANGAY IV',
  'BATU',
  'DIVISORIA',
  'INGA',
  'LANNA',
  'LEMU NORTE',
  'LEMU SUR',
  'LIWAN NORTE',
  'LIWAN SUR',
  'MADDARULUG NORTE',
  'MADDARULUG SUR',
  'MAGALALAG EAST',
  'MAGALALAG WEST',
  'MARRACURU',
  'ROMA NORTE',
  'ROMA SUR',
  'SAN ANTONIO',
  'BANGAD',
  'BUENAVISTA',
  'CALAMAGUI EAST',
  'CALAMAGUI NORTH',
  'CALAMAGUI WEST',
  'LINGALING',
  'MOZZOZZIN NORTH',
  'MOZZOZZIN SUR',
  'NAGANACAN',
  'POBLACION 1',
  'POBLACION 2',
  'POBLACION 3',
  'POBLACION GK',
  'POBLACION BLISS',
  'QUINAGABIAN',
  'SAN ISIDRO EAST',
  'SAN ISIDRO WEST',
  'SAN RAFAEL EAST',
  'SAN RAFAEL WEST',
  'VILLABUENA',
  'AGGUB',
  'ANNARONAN',
  'ANAO',
  'ANGANCASILIAN',
  'BALASIG',
  'CATABAYUNGAN',
  'CENTRO',
  'GARITA',
  'LUQUILU',
  'MAGLETICIA',
  'MASIPI EAST',
  'MASIPI WEST',
  'NGARAG',
  'SAN BERNARDO',
  'SAN JUAN',
  'SARANAY',
  'SAUI',
  'TALLAG',
  'UGAD',
  'UNION',
  'VILLAFLOR',
  'VILLAHERMOSA',
  'VILLA IMELDA',
  'VILLA JESUSA',
  'SANTA MARIA',
  'SAN PABLO',
] as const;

const BARANGAYS_BY_PROVINCE_CITY: Record<string, readonly string[]> = {
  'CAGAYAN::ENRILE': [
    'ALIBAGO',
    'BARANGAY I',
    'BARANGAY II',
    'BARANGAY III',
    'BARANGAY III-A',
    'BARANGAY IV',
    'BATU',
    'DIVISORIA',
    'INGA',
    'LANNA',
    'LEMU NORTE',
    'LEMU SUR',
    'LIWAN NORTE',
    'LIWAN SUR',
    'MADDARULUG NORTE',
    'MADDARULUG SUR',
    'MAGALALAG EAST',
    'MAGALALAG WEST',
    'MARRACURU',
    'ROMA NORTE',
    'ROMA SUR',
    'SAN ANTONIO',
  ],
  'ISABELA::SANTA MARIA': [
    'BANGAD',
    'BUENAVISTA',
    'CALAMAGUI EAST',
    'CALAMAGUI NORTH',
    'CALAMAGUI WEST',
    'DIVISORIA',
    'LINGALING',
    'MOZZOZZIN NORTH',
    'MOZZOZZIN SUR',
    'NAGANACAN',
    'POBLACION 1',
    'POBLACION 2',
    'POBLACION 3',
    'POBLACION GK',
    'POBLACION BLISS',
    'QUINAGABIAN',
    'SAN ANTONIO',
    'SAN ISIDRO EAST',
    'SAN ISIDRO WEST',
    'SAN RAFAEL EAST',
    'SAN RAFAEL WEST',
    'VILLABUENA',
  ],
  'ISABELA::CABAGAN': [
    'AGGUB',
    'ANNARONAN',
    'ANAO',
    'ANGANCASILIAN',
    'BALASIG',
    'CATABAYUNGAN',
    'CENTRO',
    'GARITA',
    'LUQUILU',
    'MAGLETICIA',
    'MASIPI EAST',
    'MASIPI WEST',
    'NGARAG',
    'SAN ANTONIO',
    'SAN BERNARDO',
    'SAN JUAN',
    'SAN PABLO',
    'SANTA MARIA',
    'SARANAY',
    'SAUI',
    'TALLAG',
    'UGAD',
    'UNION',
    'VILLAFLOR',
    'VILLAHERMOSA',
    'VILLA IMELDA',
    'VILLA JESUSA',
  ],
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async list(query: QueryCustomersDto) {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      AND: [
        query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { middleName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { contactNumber: { contains: query.search, mode: 'insensitive' } },
                { facebookAccountName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
        query.customerType ? { customerType: query.customerType as CustomerType } : {},
        query.status ? { status: query.status as never } : {},
        query.province ? { province: { contains: query.province, mode: 'insensitive' } } : {},
        query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {},
        query.barangay ? { barangay: { contains: query.barangay, mode: 'insensitive' } } : {},
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { [query.sortBy]: query.sortDir },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getById(id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async overview() {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };

    const [totalCustomers, cityGroups, topBarangayGroups, enrileCount, newCustomersThisMonth] =
      await this.prisma.$transaction([
        this.prisma.customer.count({ where }),
        this.prisma.customer.groupBy({
          by: ['city'],
          where,
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
        this.prisma.customer.groupBy({
          by: ['barangay'],
          where,
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 10,
        }),
        this.prisma.customer.count({
          where: {
            deletedAt: null,
            province: { equals: 'CAGAYAN', mode: 'insensitive' },
            city: { equals: 'ENRILE', mode: 'insensitive' },
          },
        }),
        this.prisma.customer.count({ where: this.getThisMonthWhere() }),
      ]);

    const monthlyTrend = await this.getMonthlyGrowthTrend(6);
    const averageNewCustomersLast6Months =
      monthlyTrend.length > 0
        ? Number(
            (
              monthlyTrend.reduce((sum, item) => sum + item.newCount, 0) /
              monthlyTrend.length
            ).toFixed(2),
          )
        : 0;

    const current = monthlyTrend[monthlyTrend.length - 1]?.newCount ?? 0;
    const previous = monthlyTrend[monthlyTrend.length - 2]?.newCount ?? 0;
    const trendDelta = current - previous;
    const trendDirection = trendDelta > 0 ? 'UP' : trendDelta < 0 ? 'DOWN' : 'FLAT';

    return {
      totalCustomers,
      enrileCustomers: enrileCount,
      newCustomersThisMonth,
      averageNewCustomersLast6Months,
      trendDirection,
      trendDelta,
      monthlyGrowthTrend: monthlyTrend,
      municipalities: cityGroups.map((item) => ({
        city: item.city,
        count: this.extractGroupCount(item),
      })),
      topBarangays: topBarangayGroups.map((item) => ({
        barangay: item.barangay,
        count: this.extractGroupCount(item),
      })),
    };
  }

  async create(payload: CreateCustomerDto, req: RequestWithContext) {
    await this.assertNoDuplicateCustomer({
      firstName: payload.firstName,
      lastName: payload.lastName,
      addressLine1: payload.addressLine1,
      province: payload.province,
      city: payload.city,
      barangay: payload.barangay,
      latitude: payload.latitude,
      longitude: payload.longitude,
    });

    const secondaryContacts = this.normalizeSecondaryContacts(payload);
    const [firstSecondaryContact] = secondaryContacts;
    const customer = await this.createWithGeneratedAccountNumber(
      payload,
      secondaryContacts,
      firstSecondaryContact,
      req,
    );

    await this.auditLogsService.create({
      actorUserId: req.user?.userId || 'system',
      actorUsername: req.user?.username,
      actionType: 'CREATE',
      entityType: 'Customer',
      entityId: customer.id,
      afterJson: customer as unknown as Prisma.InputJsonValue,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      correlationId: req.correlationId,
    });

    return customer;
  }

  async bulkUpload(file: { originalname: string; buffer: Buffer } | undefined, req: RequestWithContext) {
    const analyzed = await this.analyzeBulkUploadFile(file);

    if (!analyzed.templateValid) {
      throw new ConflictException(
        `Invalid template format. Missing required columns: ${analyzed.missingHeaders.join(', ')}`,
      );
    }

    if (analyzed.validPayloads.length === 0) {
      const invalidReport = await this.buildInvalidRowsReport(
        analyzed.sourceHeaders,
        analyzed.invalidRowsWithSource,
      );
      return {
        totalRows: analyzed.totalRows,
        created: 0,
        failed: analyzed.invalidRowsWithSource.length,
        failures: analyzed.invalidRowsWithSource.map((item) => ({
          row: item.rowNumber,
          message: item.errors.join('; '),
        })),
        invalidReportFilename: invalidReport.filename,
        invalidReportBase64: invalidReport.base64,
      };
    }

    const failures: BulkUploadFailure[] = [];
    let created = 0;
    const invalidRowsForReport: Array<{ rowNumber: number; errors: string[]; sourceRow: Record<string, unknown> }> =
      [...analyzed.invalidRowsWithSource];

    for (const item of analyzed.validPayloads) {
      try {
        await this.create(item.payload, req);
        created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failures.push({ row: item.rowNumber, message });
        invalidRowsForReport.push({
          rowNumber: item.rowNumber,
          errors: [message],
          sourceRow: item.sourceRow,
        });
      }
    }

    const invalidReport = await this.buildInvalidRowsReport(analyzed.sourceHeaders, invalidRowsForReport);

    return {
      totalRows: analyzed.totalRows,
      created,
      failed: invalidRowsForReport.length,
      failures,
      invalidReportFilename: invalidReport.filename,
      invalidReportBase64: invalidReport.base64,
    };
  }

  async bulkUploadPreview(
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<BulkUploadPreviewResult> {
    const analyzed = await this.analyzeBulkUploadFile(file);
    return {
      templateValid: analyzed.templateValid,
      missingHeaders: analyzed.missingHeaders,
      totalRows: analyzed.totalRows,
      validRows: analyzed.validRows,
      invalidRows: analyzed.invalidRows,
      rows: analyzed.rows,
    };
  }

  async getBulkUploadValidatedReport(file: { originalname: string; buffer: Buffer } | undefined) {
    const parsed = this.parseUploadFile(file);
    const analyzed = await this.analyzeBulkUploadFile(file);

    if (!analyzed.templateValid) {
      throw new ConflictException(
        `Invalid template format. Missing required columns: ${analyzed.missingHeaders.join(', ')}`,
      );
    }

    const errorsByRow = new Map<number, string>();
    for (const row of analyzed.rows) {
      errorsByRow.set(row.row, row.errors.join('; '));
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Validated');
    const existingErrorColumnIndex = parsed.headers.findIndex(
      (header) => this.normalizeHeader(header) === this.normalizeHeader('Error'),
    );
    const headers =
      existingErrorColumnIndex >= 0 ? [...parsed.headers] : [...parsed.headers, 'Error'];

    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const reportRows = parsed.rows.map((sourceRow, index) => {
      const excelRowNumber = index + 2;
      return {
        sourceRow,
        rowNumber: excelRowNumber,
        error: errorsByRow.get(excelRowNumber) || '',
      };
    });

    reportRows
      .sort((a, b) => {
        const aInvalid = a.error.length > 0;
        const bInvalid = b.error.length > 0;
        if (aInvalid === bInvalid) {
          return a.rowNumber - b.rowNumber;
        }
        return aInvalid ? -1 : 1;
      })
      .forEach((item) => {
        const rowValues = parsed.headers.map((header, index) =>
          index === existingErrorColumnIndex ? item.error : String(item.sourceRow[header] ?? ''),
        );
        if (existingErrorColumnIndex < 0) {
          rowValues.push(item.error);
        }
        sheet.addRow(rowValues);
      });

    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(16, Math.min(60, header.length + 6)),
    }));

    return {
      filename: 'customer-bulk-upload-validated.xlsx',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  async getBulkUploadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Customers');
    const listsSheet = workbook.addWorksheet('Lists');

    sheet.columns = [
      { header: 'firstName', key: 'firstName', width: 18 },
      { header: 'middleName', key: 'middleName', width: 16 },
      { header: 'lastName', key: 'lastName', width: 18 },
      { header: 'contactNumber', key: 'contactNumber', width: 18 },
      { header: 'alternateMobileNumber', key: 'alternateMobileNumber', width: 22 },
      { header: 'facebookAccountName', key: 'facebookAccountName', width: 24 },
      { header: 'facebookProfileLink', key: 'facebookProfileLink', width: 32 },
      { header: 'email', key: 'email', width: 28 },
      { header: 'addressLine1', key: 'addressLine1', width: 28 },
      { header: 'addressLine2', key: 'addressLine2', width: 24 },
      { header: 'province', key: 'province', width: 14 },
      { header: 'city', key: 'city', width: 20 },
      { header: 'barangay', key: 'barangay', width: 20 },
      { header: 'latitude', key: 'latitude', width: 14 },
      { header: 'longitude', key: 'longitude', width: 14 },
      { header: 'customerType', key: 'customerType', width: 16 },
    ];

    sheet.addRow({
      firstName: 'JUAN',
      middleName: 'D',
      lastName: 'DELA CRUZ',
      contactNumber: '09171234567',
      alternateMobileNumber: '09180000001',
      facebookAccountName: 'JUAN DELA CRUZ',
      facebookProfileLink: 'https://www.facebook.com/juan.delacruz',
      email: 'juan.delacruz@example.com',
      addressLine1: 'PUROK 1',
      addressLine2: '',
      province: 'CAGAYAN',
      city: 'ENRILE',
      barangay: 'ALIBAGO',
      latitude: '',
      longitude: '',
      customerType: 'RESIDENTIAL',
    });

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    listsSheet.getCell('A1').value = 'Province';
    listsSheet.getCell('B1').value = 'City';
    listsSheet.getCell('C1').value = 'Barangay';

    PROVINCES.forEach((value, index) => {
      listsSheet.getCell(`A${index + 2}`).value = value;
    });

    MUNICIPALITIES.forEach((value, index) => {
      listsSheet.getCell(`B${index + 2}`).value = value;
    });

    BARANGAYS.forEach((value, index) => {
      listsSheet.getCell(`C${index + 2}`).value = value;
    });

    listsSheet.state = 'veryHidden';

    const provinceEnd = PROVINCES.length + 1;
    const cityEnd = MUNICIPALITIES.length + 1;
    const barangayEnd = BARANGAYS.length + 1;

    for (let row = 2; row <= 1000; row += 1) {
      sheet.getCell(`K${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`Lists!$A$2:$A$${provinceEnd}`],
      };
      sheet.getCell(`L${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`Lists!$B$2:$B$${cityEnd}`],
      };
      sheet.getCell(`M${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`Lists!$C$2:$C$${barangayEnd}`],
      };
      sheet.getCell(`P${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"RESIDENTIAL,BUSINESS,ENTERPRISE"'],
      };
    }

    return {
      filename: 'customer-bulk-upload-template.xlsx',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  async update(id: string, payload: UpdateCustomerDto, req: RequestWithContext) {
    const current = await this.getById(id);
    const payloadWithoutStatus = { ...(payload as UpdateCustomerDto & { status?: unknown }) };
    delete payloadWithoutStatus.status;
    const hasSecondaryContacts = payload.secondaryContacts !== undefined;
    const secondaryContacts = this.normalizeSecondaryContacts(payload);
    const [firstSecondaryContact] = secondaryContacts;
    const nextLatitude =
      payload.latitude === undefined
        ? current.latitude
        : payload.latitude === null
          ? null
          : payload.latitude;
    const nextLongitude =
      payload.longitude === undefined
        ? current.longitude
        : payload.longitude === null
          ? null
          : payload.longitude;

    await this.assertNoDuplicateCustomer(
      {
        firstName: payload.firstName ?? current.firstName,
        lastName: payload.lastName ?? current.lastName,
        addressLine1: payload.addressLine1 ?? current.addressLine1,
        province: payload.province ?? current.province,
        city: payload.city ?? current.city,
        barangay: payload.barangay ?? current.barangay,
        latitude: nextLatitude,
        longitude: nextLongitude,
      },
      id,
    );

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...payloadWithoutStatus,
        status: null,
        secondaryContacts: hasSecondaryContacts
          ? (secondaryContacts as unknown as Prisma.InputJsonValue)
          : undefined,
        secondaryContactName:
          hasSecondaryContacts ? firstSecondaryContact?.name ?? null : undefined,
        secondaryContactNumber:
          hasSecondaryContacts ? firstSecondaryContact?.contactNumber ?? null : undefined,
        secondaryContactFacebookAccount:
          hasSecondaryContacts ? firstSecondaryContact?.facebookAccount ?? null : undefined,
        secondaryContactRelationship:
          hasSecondaryContacts ? firstSecondaryContact?.relationship ?? null : undefined,
        latitude:
          payload.latitude === undefined
            ? undefined
            : payload.latitude === null
              ? null
              : new Prisma.Decimal(payload.latitude),
        longitude:
          payload.longitude === undefined
            ? undefined
            : payload.longitude === null
              ? null
              : new Prisma.Decimal(payload.longitude),
        updatedByUserId: req.user?.userId,
      },
    });

    await this.auditLogsService.create({
      actorUserId: req.user?.userId || 'system',
      actorUsername: req.user?.username,
      actionType: 'UPDATE',
      entityType: 'Customer',
      entityId: customer.id,
      beforeJson: current as unknown as Prisma.InputJsonValue,
      afterJson: customer as unknown as Prisma.InputJsonValue,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      correlationId: req.correlationId,
    });

    return customer;
  }

  async remove(id: string, req: RequestWithContext) {
    const current = await this.getById(id);

    const customer = await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), updatedByUserId: req.user?.userId },
    });

    await this.auditLogsService.create({
      actorUserId: req.user?.userId || 'system',
      actorUsername: req.user?.username,
      actionType: 'SOFT_DELETE',
      entityType: 'Customer',
      entityId: customer.id,
      beforeJson: current as unknown as Prisma.InputJsonValue,
      afterJson: customer as unknown as Prisma.InputJsonValue,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      correlationId: req.correlationId,
    });

    return { success: true };
  }

  private normalizeSecondaryContacts(
    payload: Pick<CreateCustomerDto, 'secondaryContacts'>,
  ): SecondaryContact[] {
    const list = payload.secondaryContacts || [];
    return list
      .map((item) => ({
        name: item.name?.trim() || '',
        contactNumber: item.contactNumber?.trim() || undefined,
        facebookAccount: item.facebookAccount?.trim() || undefined,
        facebookProfileLink: item.facebookProfileLink?.trim() || undefined,
        relationship: item.relationship?.trim() || undefined,
      }))
      .filter((item) => item.name.length > 0);
  }

  private async createWithGeneratedAccountNumber(
    payload: CreateCustomerDto,
    secondaryContacts: SecondaryContact[],
    firstSecondaryContact: SecondaryContact | undefined,
    req: RequestWithContext,
  ) {
    let attempts = 0;
    while (attempts < 50) {
      const accountNumber = await this.generateSecureAccountNumber();

      try {
        return await this.prisma.customer.create({
          data: {
            ...payload,
            accountNumber,
            status: null,
            secondaryContacts: secondaryContacts as unknown as Prisma.InputJsonValue,
            secondaryContactName: firstSecondaryContact?.name,
            secondaryContactNumber: firstSecondaryContact?.contactNumber,
            secondaryContactFacebookAccount: firstSecondaryContact?.facebookAccount,
            secondaryContactRelationship: firstSecondaryContact?.relationship,
            latitude: payload.latitude ? new Prisma.Decimal(payload.latitude) : null,
            longitude: payload.longitude ? new Prisma.Decimal(payload.longitude) : null,
            createdByUserId: req.user?.userId,
            updatedByUserId: req.user?.userId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          attempts += 1;
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Unable to generate unique account number');
  }

  private async generateSecureAccountNumber() {
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const candidate = this.buildRandom8DigitAccountNumber();
      if (!this.isAllowedAccountNumberPattern(candidate)) {
        continue;
      }

      const existing = await this.prisma.customer.findUnique({
        where: { accountNumber: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException('Unable to generate unique account number');
  }

  private buildRandom8DigitAccountNumber() {
    const firstDigit = String(randomInt(1, 10));
    let accountNumber = firstDigit;
    for (let index = 0; index < 7; index += 1) {
      accountNumber += String(randomInt(0, 10));
    }
    return accountNumber;
  }

  private isAllowedAccountNumberPattern(value: string) {
    if (!/^[1-9][0-9]{7}$/.test(value)) {
      return false;
    }

    if (/^(\d)\1{7}$/.test(value)) {
      return false;
    }

    if (/^(\d)\1{3}(\d)\2{3}$/.test(value)) {
      return false;
    }

    if (/^(\d{2})\1{3}$/.test(value) || /^(\d{4})\1$/.test(value)) {
      return false;
    }

    const digits = value.split('').map((digit) => Number(digit));
    const isAscendingSequential = digits.every((digit, index) => index === 0 || digit - digits[index - 1] === 1);
    if (isAscendingSequential) {
      return false;
    }

    const isDescendingSequential = digits.every(
      (digit, index) => index === 0 || digit - digits[index - 1] === -1,
    );
    if (isDescendingSequential) {
      return false;
    }

    return true;
  }

  private async assertNoDuplicateCustomer(
    data: {
      firstName: string;
      lastName: string;
      addressLine1: string;
      province: string;
      city: string;
      barangay: string;
      latitude?: string | Prisma.Decimal | null;
      longitude?: string | Prisma.Decimal | null;
    },
    excludeId?: string,
  ) {
    const latitude = this.toDecimalOrNull(data.latitude);
    const longitude = this.toDecimalOrNull(data.longitude);
    const existing = await this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        firstName: data.firstName,
        lastName: data.lastName,
        addressLine1: data.addressLine1,
        province: data.province,
        city: data.city,
        barangay: data.barangay,
        latitude,
        longitude,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Duplicate customer detected. Same first name, last name, address line 1, province, municipality, barangay, latitude, and longitude already exists.',
      );
    }
  }

  private toDecimalOrNull(value: string | Prisma.Decimal | null | undefined) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (value instanceof Prisma.Decimal) {
      return value;
    }
    return new Prisma.Decimal(value);
  }

  private normalizeHeader(header: string) {
    return header.replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  private pickCell(normalizedRow: Map<string, string>, aliases: string[]) {
    for (const alias of aliases) {
      const value = normalizedRow.get(this.normalizeHeader(alias));
      if (value !== undefined) {
        return value;
      }
    }
    return '';
  }

  private normalizeUpper(value: string) {
    return value.trim().toUpperCase();
  }

  private extractGroupCount(item: { _count?: { id?: number } | true }) {
    if (typeof item._count === 'object' && item._count) {
      return item._count.id ?? 0;
    }
    return 0;
  }

  private getMonthRange(offsetFromCurrentMonth = 0) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetFromCurrentMonth, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { start, end };
  }

  private getThisMonthWhere(): Prisma.CustomerWhereInput {
    const { start, end } = this.getMonthRange(0);
    return {
      deletedAt: null,
      createdAt: { gte: start, lt: end },
    };
  }

  private async getMonthlyGrowthTrend(monthCount: number) {
    const { start } = this.getMonthRange(-(monthCount - 1));
    const { end } = this.getMonthRange(0);
    const endExclusive = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    const [customers, baselineTotal] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: start, lt: endExclusive },
        },
        select: { createdAt: true },
      }),
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          createdAt: { lt: start },
        },
      }),
    ]);

    const buckets: Record<string, number> = {};
    for (let i = monthCount - 1; i >= 0; i -= 1) {
      const ref = this.getMonthRange(-i).start;
      const key = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
      buckets[key] = 0;
    }

    for (const customer of customers) {
      const key = `${customer.createdAt.getUTCFullYear()}-${String(
        customer.createdAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      if (key in buckets) {
        buckets[key] += 1;
      }
    }

    let runningTotal = baselineTotal;
    return Object.entries(buckets).map(([month, newCount]) => {
      runningTotal += newCount;
      return { month, newCount, cumulativeTotal: runningTotal };
    });
  }

  private async analyzeBulkUploadFile(
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<AnalyzedBulkUpload> {
    const parsed = this.parseUploadFile(file);
    const normalizedHeaders = parsed.headers.map((header) => this.normalizeHeader(header));
    const missingHeaders = REQUIRED_UPLOAD_HEADERS.filter(
      (header) => !normalizedHeaders.includes(this.normalizeHeader(header)),
    );

    if (missingHeaders.length > 0) {
      return {
        templateValid: false,
        missingHeaders: [...missingHeaders],
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        rows: [],
        sourceHeaders: parsed.headers,
        validPayloads: [],
        invalidRowsWithSource: [],
      };
    }

    const rows = parsed.rows.map((row, index) => this.validateRowForUpload(row, index + 2));
    const duplicateGroups = new Map<string, number[]>();
    rows.forEach((row, index) => {
      if (!row.duplicateFingerprint) {
        return;
      }
      const list = duplicateGroups.get(row.duplicateFingerprint) || [];
      list.push(index);
      duplicateGroups.set(row.duplicateFingerprint, list);
    });

    duplicateGroups.forEach((indexes) => {
      if (indexes.length <= 1) {
        return;
      }
      indexes.forEach((idx) => {
        const row = rows[idx];
        row.errors.push('duplicate row detected within uploaded file');
        row.valid = false;
        row.payload = undefined;
      });
    });

    const existingDuplicateFingerprints = await this.findExistingDuplicateFingerprints(rows);
    rows.forEach((row) => {
      if (!row.duplicateFingerprint) {
        return;
      }
      if (existingDuplicateFingerprints.has(row.duplicateFingerprint)) {
        row.errors.push('duplicate customer already exists');
        row.valid = false;
        row.payload = undefined;
      }
    });

    const validPayloads = rows
      .filter((row) => row.valid && row.payload)
      .map((row) => ({
        rowNumber: row.row,
        payload: row.payload as CreateCustomerDto,
        sourceRow: row.sourceRow,
      }));
    const invalidRowsWithSource = rows
      .filter((row) => !row.valid)
      .map((row) => ({
        rowNumber: row.row,
        errors: row.errors,
        sourceRow: row.sourceRow,
      }));

    return {
      templateValid: true,
      missingHeaders: [],
      totalRows: rows.length,
      validRows: validPayloads.length,
      invalidRows: rows.length - validPayloads.length,
      rows: rows.map(({ payload, sourceRow, ...row }) => row),
      sourceHeaders: parsed.headers,
      validPayloads,
      invalidRowsWithSource,
    };
  }

  private parseUploadFile(file: { originalname: string; buffer: Buffer } | undefined): ParsedUploadFile {
    if (!file?.buffer || !file.originalname) {
      throw new ConflictException('Upload file is required');
    }

    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!extension || !['csv', 'xls', 'xlsx'].includes(extension)) {
      throw new ConflictException('Unsupported file type. Use CSV, XLS, or XLSX.');
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('No worksheet found');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const headerMatrix = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
        header: 1,
        raw: false,
      });
      const headers = (headerMatrix[0] || []).map((value) => String(value ?? '').trim());
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
        raw: false,
      });

      return { headers, rows };
    } catch {
      throw new ConflictException('Unable to parse upload file');
    }
  }

  private validateRowForUpload(
    row: Record<string, unknown>,
    rowNumber: number,
  ): BulkUploadPreviewRow & {
    payload?: CreateCustomerDto;
    sourceRow: Record<string, unknown>;
    duplicateFingerprint?: string;
    duplicateCandidate?: {
      firstName: string;
      lastName: string;
      addressLine1: string;
      province: string;
      city: string;
      barangay: string;
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
    };
  } {
    const normalized = new Map<string, string>();
    for (const [key, value] of Object.entries(row)) {
      normalized.set(this.normalizeHeader(key), String(value ?? '').trim());
    }

    const firstName = this.normalizeUpper(this.pickCell(normalized, ['firstName']));
    const lastName = this.normalizeUpper(this.pickCell(normalized, ['lastName']));
    const middleName = this.normalizeUpper(this.pickCell(normalized, ['middleName']));
    const contactNumber = this.pickCell(normalized, ['contactNumber']).trim();
    const alternateMobileNumber = this.pickCell(normalized, ['alternateMobileNumber']).trim();
    const facebookAccountName = this.normalizeUpper(this.pickCell(normalized, ['facebookAccountName']));
    const facebookProfileLink = this.pickCell(normalized, ['facebookProfileLink']).trim();
    const email = this.pickCell(normalized, ['email']).trim();
    const addressLine1 = this.normalizeUpper(this.pickCell(normalized, ['addressLine1']));
    const addressLine2 = this.normalizeUpper(this.pickCell(normalized, ['addressLine2']));
    const barangay = this.normalizeUpper(this.pickCell(normalized, ['barangay']));
    const city = this.normalizeUpper(this.pickCell(normalized, ['city', 'municipality']));
    const province = this.normalizeUpper(this.pickCell(normalized, ['province']));
    const latitude = this.pickCell(normalized, ['latitude']).trim();
    const longitude = this.pickCell(normalized, ['longitude']).trim();
    const customerTypeRaw = this.normalizeUpper(this.pickCell(normalized, ['customerType']));

    const errors: string[] = [];

    if (!firstName) errors.push('firstName is required');
    if (!lastName) errors.push('lastName is required');
    if (!contactNumber) errors.push('contactNumber is required');
    if (!facebookAccountName) errors.push('facebookAccountName is required');
    if (!addressLine1) errors.push('addressLine1 is required');
    if (!province) errors.push('province is required');
    if (!city) errors.push('city is required');
    if (!barangay) errors.push('barangay is required');

    if (contactNumber && !/^[+0-9]{7,20}$/.test(contactNumber)) {
      errors.push('contactNumber format is invalid');
    }
    if (alternateMobileNumber && !/^[+0-9]{7,20}$/.test(alternateMobileNumber)) {
      errors.push('alternateMobileNumber format is invalid');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email format is invalid');
    }
    if (facebookProfileLink) {
      try {
        const parsed = new URL(facebookProfileLink);
        if (!parsed.protocol.startsWith('http')) {
          errors.push('facebookProfileLink must use http/https');
        }
      } catch {
        errors.push('facebookProfileLink must be a valid URL');
      }
    }

    if (province && !PROVINCES.includes(province as (typeof PROVINCES)[number])) {
      errors.push('province is not allowed');
    }

    if (province && city && PROVINCES.includes(province as (typeof PROVINCES)[number])) {
      const allowedCities = MUNICIPALITIES_BY_PROVINCE[province as (typeof PROVINCES)[number]];
      if (!allowedCities.includes(city)) {
        errors.push('city does not belong to selected province');
      }
    }

    if (province && city && barangay) {
      const key = `${province}::${city}`;
      const knownBarangays = BARANGAYS_BY_PROVINCE_CITY[key];
      if (knownBarangays && !knownBarangays.includes(barangay)) {
        errors.push('barangay does not belong to selected province/city');
      }
    }

    if (latitude && Number.isNaN(Number(latitude))) {
      errors.push('latitude must be numeric');
    }
    if (longitude && Number.isNaN(Number(longitude))) {
      errors.push('longitude must be numeric');
    }

    let customerType: CustomerType = CustomerType.RESIDENTIAL;
    if (customerTypeRaw) {
      if (CUSTOMER_TYPES.includes(customerTypeRaw as (typeof CUSTOMER_TYPES)[number])) {
        customerType = customerTypeRaw as CustomerType;
      } else {
        errors.push('customerType must be RESIDENTIAL, BUSINESS, or ENTERPRISE');
      }
    }

    const payload: CreateCustomerDto | undefined =
      errors.length === 0
        ? {
            firstName,
            lastName,
            middleName: middleName || undefined,
            contactNumber,
            alternateMobileNumber: alternateMobileNumber || undefined,
            facebookAccountName,
            facebookProfileLink: facebookProfileLink || undefined,
            email: email || undefined,
            addressLine1,
            addressLine2: addressLine2 || undefined,
            barangay,
            city,
            province,
            latitude: latitude || undefined,
            longitude: longitude || undefined,
            customerType,
            secondaryContacts: [],
          }
        : undefined;

    const duplicateFingerprint =
      firstName && lastName && addressLine1 && province && city && barangay
        ? this.buildDuplicateFingerprint(
            firstName,
            lastName,
            addressLine1,
            province,
            city,
            barangay,
            latitude || null,
            longitude || null,
          )
        : undefined;
    const duplicateCandidate =
      duplicateFingerprint && (!latitude || !Number.isNaN(Number(latitude))) && (!longitude || !Number.isNaN(Number(longitude)))
        ? {
            firstName,
            lastName,
            addressLine1,
            province,
            city,
            barangay,
            latitude: this.toDecimalOrNull(latitude) as Prisma.Decimal | null,
            longitude: this.toDecimalOrNull(longitude) as Prisma.Decimal | null,
          }
        : undefined;

    return {
      row: rowNumber,
      valid: errors.length === 0,
      errors,
      preview: {
        firstName,
        lastName,
        contactNumber,
        email,
        province,
        city,
        barangay,
        customerType: customerTypeRaw || 'RESIDENTIAL',
      },
      payload,
      sourceRow: row,
      duplicateFingerprint,
      duplicateCandidate,
    };
  }

  private async findExistingDuplicateFingerprints(
    rows: Array<{
      duplicateFingerprint?: string;
      duplicateCandidate?: {
        firstName: string;
        lastName: string;
        addressLine1: string;
        province: string;
        city: string;
        barangay: string;
        latitude: Prisma.Decimal | null;
        longitude: Prisma.Decimal | null;
      };
    }>,
  ) {
    const uniqueCandidates = new Map<
      string,
      {
        firstName: string;
        lastName: string;
        addressLine1: string;
        province: string;
        city: string;
        barangay: string;
        latitude: Prisma.Decimal | null;
        longitude: Prisma.Decimal | null;
      }
    >();

    rows.forEach((row) => {
      if (row.duplicateFingerprint && row.duplicateCandidate) {
        uniqueCandidates.set(row.duplicateFingerprint, row.duplicateCandidate);
      }
    });

    if (uniqueCandidates.size === 0) {
      return new Set<string>();
    }

    const existingRows = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [...uniqueCandidates.values()].map((candidate) => ({
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          addressLine1: candidate.addressLine1,
          province: candidate.province,
          city: candidate.city,
          barangay: candidate.barangay,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        })),
      },
      select: {
        firstName: true,
        lastName: true,
        addressLine1: true,
        province: true,
        city: true,
        barangay: true,
        latitude: true,
        longitude: true,
      },
    });

    return new Set(
      existingRows.map((row) =>
        this.buildDuplicateFingerprint(
          row.firstName,
          row.lastName,
          row.addressLine1,
          row.province,
          row.city,
          row.barangay,
          row.latitude,
          row.longitude,
        ),
      ),
    );
  }

  private buildDuplicateFingerprint(
    firstName: string,
    lastName: string,
    addressLine1: string,
    province: string,
    city: string,
    barangay: string,
    latitude: string | Prisma.Decimal | null,
    longitude: string | Prisma.Decimal | null,
  ) {
    const latitudeKey =
      latitude === null || latitude === undefined || latitude === ''
        ? ''
        : latitude instanceof Prisma.Decimal
          ? latitude.toString()
          : String(latitude);
    const longitudeKey =
      longitude === null || longitude === undefined || longitude === ''
        ? ''
        : longitude instanceof Prisma.Decimal
          ? longitude.toString()
          : String(longitude);
    return [firstName, lastName, addressLine1, province, city, barangay, latitudeKey, longitudeKey].join(
      '|',
    );
  }

  private async buildInvalidRowsReport(
    sourceHeaders: string[],
    rows: Array<{ rowNumber: number; errors: string[]; sourceRow: Record<string, unknown> }>,
  ) {
    if (rows.length === 0) {
      return { filename: null as string | null, base64: null as string | null };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Invalid Rows');
    const headers = [...sourceHeaders, 'Error'];

    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };

    for (const item of rows) {
      const rowValues = headers.slice(0, -1).map((header) => String(item.sourceRow[header] ?? ''));
      rowValues.push(item.errors.join('; '));
      sheet.addRow(rowValues);
    }

    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(16, Math.min(60, header.length + 6)),
    }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: `customer-bulk-upload-invalid-rows-${new Date().toISOString().slice(0, 10)}.xlsx`,
      base64: buffer.toString('base64'),
    };
  }
}
