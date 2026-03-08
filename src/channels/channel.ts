export interface Attachment {
  filePath: string;
  fileName: string;
}

export interface IncomingMessage {
  userId: string;
  userName: string;
  text: string;
  channelId: string;
  rawEvent: unknown;
  attachments?: Attachment[];
}

export interface ChannelResponse {
  text: string;
  images?: string[];
}

export type MessageHandler = (msg: IncomingMessage) => Promise<ChannelResponse>;

export interface Channel {
  name: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
}
