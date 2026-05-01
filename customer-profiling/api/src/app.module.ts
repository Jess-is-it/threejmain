import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CustomersModule } from './customers/customers.module';
import { CustomerServicesModule } from './customer-services/customer-services.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { PrismaModule } from './prisma.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { CorrelationLoggingInterceptor } from './common/logging.interceptor';
import { ModuleRegistryModule } from './module-registry/module-registry.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    CustomersModule,
    CustomerServicesModule,
    AuditLogsModule,
    ModuleRegistryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationLoggingInterceptor,
    },
  ],
})
export class AppModule {}
