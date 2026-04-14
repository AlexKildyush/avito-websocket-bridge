export interface AvitoMessageSnapshot {
  messageId: string;
  contactName: string;
  text: string;
  receivedAt: string;
}

export interface RuntimeState {
  state: 'starting' | 'running' | 'needs-auth' | 'error' | 'stopped';
  detail: string;
  publicUrl?: string;
  updatedAt: string;
  targetContacts: string[];
}
