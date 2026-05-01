import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryAuditLogsDto) {
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        query.search
          ? {
              OR: [
                { actorUsername: { contains: query.search, mode: 'insensitive' } },
                { actorUserId: { contains: query.search, mode: 'insensitive' } },
                { entityType: { contains: query.search, mode: 'insensitive' } },
                { actionType: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
        query.actionType ? { actionType: query.actionType } : {},
        query.entityType ? { entityType: query.entityType } : {},
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { [query.sortBy]: query.sortDir },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async create(entry: {
    actorUserId: string;
    actorUsername?: string;
    actionType: string;
    entityType: string;
    entityId: string;
    beforeJson?: Prisma.InputJsonValue;
    afterJson?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        moduleName: 'customer-profiling',
        ...entry,
      },
    });
  }
}
