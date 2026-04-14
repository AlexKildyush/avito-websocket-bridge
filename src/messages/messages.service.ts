import { Injectable } from '@nestjs/common';

export interface OutboundMessage {
  contactName: string;
  text: string;
  receivedAt: string;
  source: 'avito';
}

export interface BridgeStatusEvent {
  state: 'starting' | 'running' | 'needs-auth' | 'error' | 'stopped';
  detail: string;
  updatedAt: string;
}

@Injectable()
export class MessagesService {
  private readonly messages: OutboundMessage[] = [];
  private latestStatus: BridgeStatusEvent = {
    state: 'starting',
    detail: 'Service is booting',
    updatedAt: new Date().toISOString(),
  };

  pushMessage(message: OutboundMessage): void {
    this.messages.unshift(message);
    this.messages.splice(50);
  }

  getMessages(): OutboundMessage[] {
    return [...this.messages];
  }

  setStatus(status: BridgeStatusEvent): void {
    this.latestStatus = status;
  }

  getStatus(): BridgeStatusEvent {
    return this.latestStatus;
  }
}
