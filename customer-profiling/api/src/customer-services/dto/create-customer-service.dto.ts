import { AssignmentStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateCustomerServiceDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsEnum(AssignmentStatus)
  status!: AssignmentStatus;
}
