import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { MessagesGateway } from '../messages/messages.gateway';
import { OutboundMessage } from '../messages/messages.service';
import { AvitoMessageSnapshot, RuntimeState } from './avito.types';

type BridgeState = RuntimeState['state'];

@Injectable()
export class AvitoBridgeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AvitoBridgeService.name);
  private browser?: Browser;
  private page?: Page;
  private monitorTimer?: NodeJS.Timeout;
  private processedMessageIds = new Set<string>();
  private runtimeState: RuntimeState;

  constructor(
    private readonly configService: ConfigService,
    private readonly messagesGateway: MessagesGateway,
  ) {
    this.runtimeState = {
      state: 'starting',
      detail: 'Bridge is booting',
      publicUrl: this.configService.get<string>('CLOUDFLARED_PUBLIC_URL') || undefined,
      updatedAt: new Date().toISOString(),
      targetContacts: this.getTargetContacts(),
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.startBridge();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopBridge('Service shutdown requested');
  }

  getRuntimeState(): RuntimeState {
    return this.runtimeState;
  }

  private async startBridge(): Promise<void> {
    this.updateState('starting', 'Launching Puppeteer');

    try {
      await this.ensureSessionDirectory();
      this.browser = await puppeteer.launch({
        headless: this.configService.get<boolean>('PUPPETEER_HEADLESS') ?? false,
        slowMo: this.configService.get<number>('PUPPETEER_SLOW_MO') ?? 0,
        userDataDir: resolve(
          process.cwd(),
          this.configService.get<string>('AVITO_USER_DATA_DIR') ?? '.avito-session',
        ),
        defaultViewport: {
          width: 1440,
          height: 960,
        },
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      this.page = await this.browser.newPage();
      this.page.setDefaultTimeout(
        this.configService.get<number>('PUPPETEER_TIMEOUT_MS') ?? 30000,
      );

      await this.page.goto(
        this.configService.get<string>('AVITO_MESSAGES_URL', { infer: true })!,
        { waitUntil: 'domcontentloaded' },
      );

      const authenticated = await this.ensureAuthenticated();
      if (!authenticated) {
        this.updateState(
          'needs-auth',
          'Manual Avito login is required in the opened browser profile',
        );
        return;
      }

      await this.openTargetConversation();
      await this.primeProcessedMessages();
      this.startMonitoringLoop();
      this.updateState('running', 'Listening for new Avito messages');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown bridge error';
      this.logger.error(detail, error instanceof Error ? error.stack : undefined);
      this.updateState('error', detail);
    }
  }

  private async stopBridge(reason: string): Promise<void> {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
      this.page = undefined;
    }

    this.updateState('stopped', reason);
  }

  private async ensureSessionDirectory(): Promise<void> {
    const relativeDir =
      this.configService.get<string>('AVITO_USER_DATA_DIR') ?? '.avito-session';
    await mkdir(join(process.cwd(), relativeDir), { recursive: true });
  }

  private async ensureAuthenticated(): Promise<boolean> {
    const page = this.requirePage();

    if (await this.isMessengerVisible()) {
      return true;
    }

    const login = this.configService.get<string>('AVITO_LOGIN');
    const password = this.configService.get<string>('AVITO_PASSWORD');

    if (!login || !password) {
      this.logger.warn(
        'AVITO_LOGIN or AVITO_PASSWORD is not configured. Falling back to persisted manual session.',
      );
      return false;
    }

    await this.tryCredentialLogin(login, password);
    return this.isMessengerVisible();
  }

  private async tryCredentialLogin(login: string, password: string): Promise<void> {
    const page = this.requirePage();
    const baseUrl = this.configService.get<string>('AVITO_BASE_URL', { infer: true })!;
    await page.goto(`${baseUrl}/#login?authsrc=messages`, {
      waitUntil: 'domcontentloaded',
    });

    const loginSelector = 'input[name="login"], input[type="tel"], input[type="text"]';
    const passwordSelector = 'input[type="password"]';
    const submitSelector = 'button[type="submit"]';

    await page.waitForSelector(loginSelector, { timeout: 15000 });
    await page.locator(loginSelector).fill(login);
    await page.waitForSelector(passwordSelector, { timeout: 15000 });
    await page.locator(passwordSelector).fill(password);
    await page.locator(submitSelector).click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(
      () => undefined,
    );

    await page.goto(
      this.configService.get<string>('AVITO_MESSAGES_URL', { infer: true })!,
      { waitUntil: 'domcontentloaded' },
    );
  }

  private async isMessengerVisible(): Promise<boolean> {
    const page = this.requirePage();
    const selectors = [
      '[data-marker="chat-list"]',
      '[data-marker="messenger"]',
      '[class*="messenger"]',
    ];

    for (const selector of selectors) {
      if (await page.$(selector)) {
        return true;
      }
    }

    return false;
  }

  private async openTargetConversation(): Promise<void> {
    const page = this.requirePage();
    const targetContacts = this.getTargetContacts();

    const opened = await page.evaluate((names) => {
      const clickableNodes = Array.from(
        document.querySelectorAll<HTMLElement>('a, button, div, li'),
      );

      const normalizedNames = names.map((name) => name.trim().toLowerCase());
      const target = clickableNodes.find((node) => {
        const text = node.innerText?.trim().toLowerCase();
        return text && normalizedNames.some((name) => text.includes(name));
      });

      if (target) {
        target.click();
        return true;
      }

      return false;
    }, targetContacts);

    if (!opened) {
      throw new Error(
        `Target chat not found. Checked contacts: ${targetContacts.join(', ')}`,
      );
    }

    await this.delay(2000);
  }

  private async primeProcessedMessages(): Promise<void> {
    const snapshots = await this.readConversationMessages();
    snapshots.forEach((snapshot) => this.processedMessageIds.add(snapshot.messageId));
  }

  private startMonitoringLoop(): void {
    this.monitorTimer = setInterval(() => {
      void this.pullNewMessages();
    }, 3000);
  }

  private async pullNewMessages(): Promise<void> {
    try {
      const snapshots = await this.readConversationMessages();
      const freshMessages = snapshots.filter(
        (snapshot) => !this.processedMessageIds.has(snapshot.messageId),
      );

      for (const snapshot of freshMessages) {
        this.processedMessageIds.add(snapshot.messageId);
        this.publishMessage(snapshot);
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown error while reading messages';
      this.logger.error(detail, error instanceof Error ? error.stack : undefined);
      this.updateState('error', detail);
    }
  }

  private publishMessage(snapshot: AvitoMessageSnapshot): void {
    const message: OutboundMessage = {
      contactName: snapshot.contactName,
      text: snapshot.text,
      receivedAt: snapshot.receivedAt,
      source: 'avito',
    };

    this.messagesGateway.broadcastMessage(message);
    this.updateState('running', `Last message received from ${snapshot.contactName}`);
  }

  private async readConversationMessages(): Promise<AvitoMessageSnapshot[]> {
    const page = this.requirePage();
    const targetContacts = this.getTargetContacts();

    return page.evaluate((names) => {
      const normalizedNames = names.map((name) => name.trim().toLowerCase());
      const messageNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-marker="chat-message"], [class*="message"], [data-marker*="message"]',
        ),
      );

      return messageNodes
        .map((node, index) => {
          const text = node.innerText?.trim();
          if (!text) {
            return null;
          }

          const containerText = node.closest<HTMLElement>('[class*="chat"], [class*="message"]')
            ?.innerText;
          const matchedName = normalizedNames.find((name) =>
            containerText?.toLowerCase().includes(name),
          );

          return {
            messageId:
              node.dataset.messageId ||
              node.getAttribute('data-id') ||
              `${index}:${text}`,
            contactName: matchedName ?? names[0] ?? 'Unknown',
            text,
            receivedAt: new Date().toISOString(),
          };
        })
        .filter((item): item is AvitoMessageSnapshot => Boolean(item));
    }, targetContacts);
  }

  private getTargetContacts(): string[] {
    return (this.configService.get<string>('TARGET_CONTACTS') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async delay(timeoutMs: number): Promise<void> {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs));
  }

  private updateState(state: BridgeState, detail: string): void {
    this.runtimeState = {
      state,
      detail,
      publicUrl: this.configService.get<string>('CLOUDFLARED_PUBLIC_URL') || undefined,
      updatedAt: new Date().toISOString(),
      targetContacts: this.getTargetContacts(),
    };

    this.messagesGateway.broadcastStatus({
      state,
      detail,
      updatedAt: this.runtimeState.updatedAt,
    });
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('Puppeteer page is not initialized');
    }

    return this.page;
  }
}
