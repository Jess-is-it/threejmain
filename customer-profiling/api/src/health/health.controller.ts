import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_BASE_PATH, MODULE_NAME, MODULE_VERSION } from '../config/constants';
import { Public } from '../common/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return {
      status: 'ok',
      module: MODULE_NAME,
      version: MODULE_VERSION,
      basePath: API_BASE_PATH,
      timestamp: new Date().toISOString(),
    };
  }
}
