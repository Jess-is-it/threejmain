import {
  Body,
  Controller,
  Delete,
  Get,
  UploadedFile,
  UseInterceptors,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CustomersService } from './customers.service';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { RequestWithContext } from '../common/request-context';
import { RbacGuard } from '../common/rbac.guard';
import { Permissions } from '../common/permissions.decorator';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(RbacGuard)
@Controller('v1/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Permissions('customers.read')
  list(@Query() query: QueryCustomersDto) {
    return this.customersService.list(query);
  }

  @Get('bulk-upload-template')
  @Permissions('customers.read')
  async downloadBulkUploadTemplate(@Res() res: Response) {
    const template = await this.customersService.getBulkUploadTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`);
    res.send(template.buffer);
  }

  @Get('overview')
  @Permissions('customers.read')
  overview() {
    return this.customersService.overview();
  }

  @Get(':id')
  @Permissions('customers.read')
  getById(@Param('id') id: string) {
    return this.customersService.getById(id);
  }

  @Post()
  @Permissions('customers.write')
  create(@Body() payload: CreateCustomerDto, @Req() req: RequestWithContext) {
    return this.customersService.create(payload, req);
  }

  @Post('bulk-upload')
  @Permissions('customers.write')
  @UseInterceptors(FileInterceptor('file'))
  bulkUpload(@UploadedFile() file: { originalname: string; buffer: Buffer }, @Req() req: RequestWithContext) {
    return this.customersService.bulkUpload(file, req);
  }

  @Post('bulk-upload-preview')
  @Permissions('customers.write')
  @UseInterceptors(FileInterceptor('file'))
  bulkUploadPreview(@UploadedFile() file: { originalname: string; buffer: Buffer }) {
    return this.customersService.bulkUploadPreview(file);
  }

  @Post('bulk-upload-validated-report')
  @Permissions('customers.write')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUploadValidatedReport(
    @UploadedFile() file: { originalname: string; buffer: Buffer },
    @Res() res: Response,
  ) {
    const report = await this.customersService.getBulkUploadValidatedReport(file);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.send(report.buffer);
  }

  @Patch(':id')
  @Permissions('customers.write')
  update(
    @Param('id') id: string,
    @Body() payload: UpdateCustomerDto,
    @Req() req: RequestWithContext,
  ) {
    return this.customersService.update(id, payload, req);
  }

  @Delete(':id')
  @Permissions('customers.write')
  remove(@Param('id') id: string, @Req() req: RequestWithContext) {
    return this.customersService.remove(id, req);
  }
}
