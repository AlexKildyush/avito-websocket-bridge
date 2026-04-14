import { Controller, Get } from '@nestjs/common';
import { AvitoBridgeService } from './avito/avito-bridge.service';

@Controller('api')
export class AppController {
  constructor(private readonly avitoBridgeService: AvitoBridgeService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      bridge: this.avitoBridgeService.getRuntimeState(),
      now: new Date().toISOString(),
    };
  }
}
