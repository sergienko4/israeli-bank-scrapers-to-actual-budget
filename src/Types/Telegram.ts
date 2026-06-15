/**
 * Telegram Bot API wire types and the parsed receipt shape.
 */

export interface ITelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface ITelegramMessageData {
  chat: { id: number };
  text?: string;
  photo?: ITelegramPhotoSize[];
  caption?: string;
  date: number;
}

export interface IReceiptData {
  date?: string;
  amount?: number;
  merchant?: string;
  memo?: string;
}

export interface ITelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number }; date: number };
}

export interface ITelegramUpdate {
  update_id: number;
  message?: ITelegramMessageData;
  callback_query?: ITelegramCallbackQuery;
}

export interface ITelegramApiResponse {
  ok: boolean;
  result?: ITelegramUpdate[];
}
