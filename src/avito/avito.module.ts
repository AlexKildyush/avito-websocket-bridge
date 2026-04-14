import { Module } from '@nestjs/common';
import { AvitoBridgeService } from './avito-bridge.service';

@Module({
  providers: [AvitoBridgeService],
  exports: [AvitoBridgeService],
})
export class AvitoModule {}
