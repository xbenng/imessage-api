export interface Chat {
  id: number;
  guid: string;
  chatIdentifier: string;
  style: number; // 45=individual, 43=group
  displayName: string;
  serviceName: string;
  participants: Participant[];
  lastMessageDate: number | null; // Unix ms
  lastMessagePreview: string;
  messageCount: number;
}

export interface Participant {
  handleId: string;
  displayName: string;
  service: string;
}

export interface Message {
  id: number;
  guid: string;
  text: string | null;
  isFromMe: boolean;
  date: number | null; // Unix ms
  dateRead: number | null;
  dateDelivered: number | null;
  handleId: string | null;
  senderName: string;
  chatId: number;
  associatedMessageType: number;
  associatedMessageGuid: string | null;
  threadOriginatorGuid: string | null;
  attachments: Attachment[];
  tapbacks: Tapback[];
  isAudioMessage: boolean;
  expressiveSendStyleId: string | null;
  service: string | null;
}

export interface Attachment {
  id: number;
  filename: string | null;
  mimeType: string | null;
  totalBytes: number;
  transferName: string | null;
  isSticker: boolean;
}

export interface Tapback {
  type: number; // 2000=love, 2001=like, 2002=laugh, 2003=emphasis, 2004=dislike, 2005=question
  isFromMe: boolean;
  senderName: string;
  associatedMessageGuid: string;
}

export interface SearchResult {
  messageId: number;
  text: string;
  chatId: number;
  chatDisplayName: string;
  senderName: string;
  isFromMe: boolean;
  date: number | null;
}

export interface ContactMap {
  [handleId: string]: string;
}

export interface PollResponse {
  messages: Message[];
  maxRowid: number;
}
