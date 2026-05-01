import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateCustomerServiceDto } from './dto/create-customer-service.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RequestWithContext } from '../common/request-context';

@Injectable()
export class CustomerServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async listByCustomer(customerId: string) {
    return this.prisma.customerService.findMany({
      where: { customerId },
      orderBy: { startDate: 'desc' },
    });
  }

  async assign(customerId: string, payload: CreateCustomerServiceDto, req: RequestWithContext) {
    const created = await this.prisma.customerService.create({
      data: {
        customerId,
        planId: payload.planId,
        serviceId: payload.serviceId,
        startDate: new Date(payload.startDate),
        endDate: payload.endDate ? new Date(payload.endDate) : null,
        status: payload.status,
      },
    });

    await this.auditLogsService.create({
      actorUserId: req.user?.userId || 'system',
      actorUsername: req.user?.username,
      actionType: 'ASSIGN_SERVICE',
      entityType: 'CustomerService',
      entityId: created.id,
      afterJson: created as unknown as Prisma.InputJsonValue,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
      correlationId: req.correlationId,
    });

    return created;
  }
}
