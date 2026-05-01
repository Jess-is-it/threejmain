import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerServicesService } from './customer-services.service';
import { CreateCustomerServiceDto } from './dto/create-customer-service.dto';
import { RequestWithContext } from '../common/request-context';

@ApiTags('customer-services')
@ApiBearerAuth()
@Controller('v1/customers/:id/services')
export class CustomerServicesController {
  constructor(private readonly customerServicesService: CustomerServicesService) {}

  @Get()
  list(@Param('id') customerId: string) {
    return this.customerServicesService.listByCustomer(customerId);
  }

  @Post()
  assign(
    @Param('id') customerId: string,
    @Body() payload: CreateCustomerServiceDto,
    @Req() req: RequestWithContext,
  ) {
    return this.customerServicesService.assign(customerId, payload, req);
  }
}
