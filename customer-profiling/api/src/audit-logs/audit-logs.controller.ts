import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('v1/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(@Query() query: QueryAuditLogsDto) {
    return this.auditLogsService.list(query);
  }
}
