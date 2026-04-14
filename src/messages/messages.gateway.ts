import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  BridgeStatusEvent,
  MessagesService,
  OutboundMessage,
} from './messages.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(private readonly messagesService: MessagesService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    client.emit('bootstrap', {
      messages: this.messagesService.getMessages(),
      status: this.messagesService.getStatus(),
    });
  }

  broadcastMessage(message: OutboundMessage): void {
    this.messagesService.pushMessage(message);
    this.server.emit('message', message);
  }

  broadcastStatus(status: BridgeStatusEvent): void {
    this.messagesService.setStatus(status);
    this.server.emit('status', status);
  }

  @SubscribeMessage('ping')
  handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): void {
    client.emit('pong', {
      echoedPayload: payload,
      now: new Date().toISOString(),
    });
  }
}
