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

export interface RenderPageOptions {
  readonly pageNumber: number;
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  readonly devicePixelRatio?: number;
}

export interface IPdfDocumentHandle {
  readonly totalPages: number;
  getMetadata(): Promise<PdfDocumentMetadata>;
  extractOutline(): Promise<PdfOutlineItem[]>;
  renderPageToCanvas(options: RenderPageOptions): Promise<void>;
  prefetchPage(pageNumber: number): Promise<void>;
  cancelActiveRender(canvas: HTMLCanvasElement): void;
  destroy(): Promise<void>;
}

export interface IPdfEngine {
  /**
   * Loads a PDF document from a Blob or ArrayBuffer and returns an isolated handle.
   */
  loadDocument(source: Blob | ArrayBuffer): Promise<IPdfDocumentHandle>;

  /**
   * Generates a cover thumbnail data URL and extracts metadata from page 1 using an offscreen canvas.
   */
  extractCoverAndMetadata(
    source: Blob | ArrayBuffer,
    fallbackTitle: string
  ): Promise<{
    readonly title: string;
    readonly author: string;
    readonly totalPages: number;
    readonly coverDataUrl: string;
  }>;
}
