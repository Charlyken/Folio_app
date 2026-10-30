/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PdfOutlineItem {
  readonly title: string;
  readonly pageNumber: number;
  readonly items: readonly PdfOutlineItem[];
}

export interface PdfDocumentMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly totalPages: number;
}

export interface PdfTextSpanItem {
  readonly str: string;
  readonly xRatio: number; // Normalized [0..1] from left edge of viewport
  readonly yRatio: number; // Normalized [0..1] from top edge of viewport
  readonly widthRatio: number; // Normalized [0..1] width
  readonly heightRatio: number; // Normalized [0..1] height
  readonly fontSizeRatio: number; // Normalized font height relative to page height
}

export interface RenderPageOptions {
  readonly pageNumber: number;
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  readonly devicePixelRatio?: number;
  readonly autoCropMargins?: boolean;
}

export interface IPdfDocumentHandle {
  readonly totalPages: number;
  getMetadata(): Promise<PdfDocumentMetadata>;
  extractOutline(): Promise<PdfOutlineItem[]>;
  renderPageToCanvas(options: RenderPageOptions): Promise<void>;
  renderPageThumbnail(pageNumber: number, targetWidth?: number): Promise<string>;
  getPageTextItems(
    pageNumber: number,
    autoCropMargins?: boolean
  ): Promise<readonly PdfTextSpanItem[]>;
  extractAllPagesPlainText(): Promise<readonly { readonly pageNumber: number; readonly text: string }[]>;
  prefetchPage(pageNumber: number): Promise<void>;
  cancelActiveRender(canvas: HTMLCanvasElement): void;
  destroy(): Promise<void>;
}

export interface PdfChunkedSource {
  readonly length: number;
  readonly getRange: (begin: number, end: number) => Promise<Uint8Array>;
}

export interface IPdfEngine {
  /**
   * Loads a PDF document from a Blob, ArrayBuffer, or chunked range provider and returns an isolated handle.
   */
  loadDocument(source: Blob | ArrayBuffer | PdfChunkedSource): Promise<IPdfDocumentHandle>;

  /**
   * Generates a cover thumbnail data URL, extracts metadata, and extracts plain text of all pages for full-text indexing.
   */
  extractCoverAndMetadata(
    source: Blob | ArrayBuffer,
    fallbackTitle: string
  ): Promise<{
    readonly title: string;
    readonly author: string;
    readonly totalPages: number;
    readonly coverDataUrl: string;
    readonly pagesText: readonly { readonly pageNumber: number; readonly text: string }[];
  }>;
}
