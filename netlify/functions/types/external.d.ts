declare module 'pdf-parse' {
  export interface PdfParseResult {
    text: string;
  }

  export default function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
}

declare module 'pdfkit' {
  import { EventEmitter } from 'node:events';

  type PdfOptions = {
    margin?: number;
    size?: string | [number, number];
  };

  export default class PDFDocument extends EventEmitter {
    constructor(options?: PdfOptions);
    fontSize(size: number): this;
    text(text: string, options?: Record<string, unknown>): this;
    moveDown(lines?: number): this;
    end(): void;
  }
}
