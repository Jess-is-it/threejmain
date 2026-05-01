import { Module } from '@nestjs/common';
import { CustomerServicesController } from './customer-services.controller';
import { CustomerServicesService } from './customer-services.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [CustomerServicesController],
  providers: [CustomerServicesService],
})
export class CustomerServicesModule {}
