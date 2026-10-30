/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createAppError } from '../../domain/entities/AsyncState';
import {
  IPdfDocumentHandle,
  IPdfEngine,
  PdfChunkedSource,
  PdfDocumentMetadata,
  PdfOutlineItem,
  RenderPageOptions,
} from '../../domain/services/IPdfEngine';

// Configure Web Worker once so PDF parsing and rasterization never block the Main Thread
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const COVER_THUMBNAIL_SCALE = 0.75;
const COVER_JPEG_QUALITY = 0.85;
const MAX_CACHED_PREFETCH_PAGES = 4;
const MAX_CACHED_THUMBNAILS = 24;
const AUTO_CROP_MARGIN_RATIO = 0.085; // Trim 8.5% outer academic margins when Auto-Crop is active

interface RawPdfMetadataInfo {
  Title?: string;
  Author?: string;
}

interface RawOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineNode[];
}

class PdfJsDocumentHandle implements IPdfDocumentHandle {
  private readonly pdfDoc: PDFDocumentProxy;
  private readonly activeRenderTasks = new WeakMap<HTMLCanvasElement, RenderTask>();
  private readonly pageCache = new Map<number, PDFPageProxy>();
  private readonly thumbnailCache = new Map<string, string>();

  constructor(pdfDoc: PDFDocumentProxy) {
    this.pdfDoc = pdfDoc;
  }

  public get totalPages(): number {
    return this.pdfDoc.numPages;
  }

  public async getMetadata(): Promise<PdfDocumentMetadata> {
    try {
      const meta = await this.pdfDoc.getMetadata();
      const info = (meta?.info ?? {}) as RawPdfMetadataInfo;
      const rawTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
      const rawAuthor = typeof info.Author === 'string' ? info.Author.trim() : '';
      return {
        title: rawTitle.length > 0 ? rawTitle : null,
        author: rawAuthor.length > 0 ? rawAuthor : null,
        totalPages: this.pdfDoc.numPages,
      };
    } catch {
      return {
        title: null,
        author: null,
        totalPages: this.pdfDoc.numPages,
      };
    }
  }

  private async getOrLoadPage(pageNumber: number): Promise<PDFPageProxy> {
    const clamped = Math.max(1, Math.min(pageNumber, this.pdfDoc.numPages));
    const cached = this.pageCache.get(clamped);
    if (cached) {
      return cached;
    }

    const page = await this.pdfDoc.getPage(clamped);
    if (this.pageCache.size >= MAX_CACHED_PREFETCH_PAGES) {
      const oldestKey = this.pageCache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldPage = this.pageCache.get(oldestKey);
        oldPage?.cleanup();
        this.pageCache.delete(oldestKey);
      }
    }
    this.pageCache.set(clamped, page);
    return page;
  }

  public async prefetchPage(pageNumber: number): Promise<void> {
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) {
      return;
    }
    try {
      await this.getOrLoadPage(pageNumber);
    } catch {
      // Prefetch is non-blocking best-effort
    }
  }

  public cancelActiveRender(canvas: HTMLCanvasElement): void {
    const existingTask = this.activeRenderTasks.get(canvas);
    if (existingTask) {
      try {
        existingTask.cancel();
      } catch {
        // Ignore cancellation errors
      }
      this.activeRenderTasks.delete(canvas);
    }
  }

  public async renderPageToCanvas(options: RenderPageOptions): Promise<void> {
    const { pageNumber, canvas, scale, autoCropMargins = false } = options;
    const dpr = options.devicePixelRatio ?? Math.min(window.devicePixelRatio || 1, 2.5);

    this.cancelActiveRender(canvas);

    const page = await this.getOrLoadPage(pageNumber);

    // When Auto-Crop is enabled, zoom into the central printable area by trimming outer margins
    const cropZoomBoost = autoCropMargins ? 1 / (1 - AUTO_CROP_MARGIN_RATIO * 2) : 1;
    const effectiveScale = scale * cropZoomBoost;

    const cssViewport = page.getViewport({ scale });
    const fullRenderViewport = page.getViewport({ scale: effectiveScale * dpr });

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw createAppError(
        'RENDER_FAILED',
        'Erreur graphique Canvas',
        'Impossible d’initialiser le contexte 2D haute résolution.'
      );
    }

    canvas.width = Math.floor(cssViewport.width * dpr);
    canvas.height = Math.floor(cssViewport.height * dpr);
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;

    context.save();
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Offset viewport origin when autoCropMargins is enabled so outer margins are cropped out
    const offsetX = autoCropMargins
      ? -Math.floor(fullRenderViewport.width * AUTO_CROP_MARGIN_RATIO)
      : 0;
    const offsetY = autoCropMargins
      ? -Math.floor(fullRenderViewport.height * AUTO_CROP_MARGIN_RATIO)
      : 0;

    const croppedViewport = fullRenderViewport.clone({
      offsetX,
      offsetY,
    });

    const renderTask = page.render({
      canvasContext: context,
      viewport: croppedViewport,
      canvas,
    });

    this.activeRenderTasks.set(canvas, renderTask);

    try {
      await renderTask.promise;
    } catch (err: unknown) {
      const errorObj = err as { name?: string };
      if (errorObj?.name === 'RenderingCancelledException') {
        return;
      }
      throw createAppError(
        'RENDER_FAILED',
        'Échec du rendu de la page',
        `La page ${pageNumber} n’a pas pu être affichée correctement.`
      );
    } finally {
      context.restore();
      if (this.activeRenderTasks.get(canvas) === renderTask) {
        this.activeRenderTasks.delete(canvas);
      }
    }
  }

  public async renderPageThumbnail(
    pageNumber: number,
    targetWidth = 136
  ): Promise<string> {
    const clamped = Math.max(1, Math.min(pageNumber, this.pdfDoc.numPages));
    const cacheKey = `${clamped}:${targetWidth}`;
    const existing = this.thumbnailCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const page = await this.getOrLoadPage(clamped);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / Math.max(1, unscaledViewport.width);
    const thumbViewport = page.getViewport({ scale });

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.floor(thumbViewport.width));
    offscreen.height = Math.max(1, Math.floor(thumbViewport.height));

    try {
      const ctx = offscreen.getContext('2d', { alpha: false });
      if (!ctx) return '';

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);

      await page.render({
        canvasContext: ctx,
        viewport: thumbViewport,
        canvas: offscreen,
      }).promise;

      const dataUrl = offscreen.toDataURL('image/jpeg', 0.78);
      if (this.thumbnailCache.size >= MAX_CACHED_THUMBNAILS) {
        const oldest = this.thumbnailCache.keys().next().value;
        if (oldest !== undefined) {
          this.thumbnailCache.delete(oldest);
        }
      }
      this.thumbnailCache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      return '';
    } finally {
      offscreen.width = 0;
      offscreen.height = 0;
    }
  }

  public async extractOutline(): Promise<PdfOutlineItem[]> {
    try {
      const rawOutline = (await this.pdfDoc.getOutline()) as RawOutlineNode[] | null;
      if (!rawOutline || rawOutline.length === 0) {
        return [];
      }
      return await this.mapOutlineNodes(rawOutline);
    } catch {
      return [];
    }
  }

  private async mapOutlineNodes(nodes: RawOutlineNode[]): Promise<PdfOutlineItem[]> {
    const result: PdfOutlineItem[] = [];
    for (const node of nodes) {
      const pageNumber = await this.resolveDestToPageNumber(node.dest);
      const children =
        node.items && node.items.length > 0
          ? await this.mapOutlineNodes(node.items)
          : [];
      result.push({
        title: node.title?.trim() || 'Section sans titre',
        pageNumber,
        items: children,
      });
    }
    return result;
  }

  private async resolveDestToPageNumber(
    dest: string | unknown[] | null
  ): Promise<number> {
    if (!dest) return 1;
    try {
      let explicitDest: unknown[] | null = null;
      if (typeof dest === 'string') {
        explicitDest = await this.pdfDoc.getDestination(dest);
      } else if (Array.isArray(dest)) {
        explicitDest = dest;
      }

      if (!explicitDest || explicitDest.length === 0) {
        return 1;
      }

      const ref = explicitDest[0];
      if (typeof ref === 'number') {
        return Math.max(1, Math.min(ref + 1, this.pdfDoc.numPages));
      }
      if (typeof ref === 'object' && ref !== null) {
        const pageIndex = await this.pdfDoc.getPageIndex(
          ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]
        );
        return Math.max(1, Math.min(pageIndex + 1, this.pdfDoc.numPages));
      }
      return 1;
    } catch {
      return 1;
    }
  }

  public async destroy(): Promise<void> {
    for (const page of this.pageCache.values()) {
      try {
        page.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.pageCache.clear();
    this.thumbnailCache.clear();
    try {
      await this.pdfDoc.cleanup();
      const docWithDestroy = this.pdfDoc as unknown as {
        destroy?: () => Promise<void>;
      };
      if (typeof docWithDestroy.destroy === 'function') {
        await docWithDestroy.destroy();
      }
    } catch {
      // Ignore destroy errors
    }
  }
}

function isChunkedSource(
  source: Blob | ArrayBuffer | PdfChunkedSource
): source is PdfChunkedSource {
  return (
    typeof source === 'object' &&
    source !== null &&
    'length' in source &&
    'getRange' in source &&
    typeof (source as PdfChunkedSource).getRange === 'function'
  );
}

export class PdfJsAdapter implements IPdfEngine {
  public async loadDocument(
    source: Blob | ArrayBuffer | PdfChunkedSource
  ): Promise<IPdfDocumentHandle> {
    try {
      if (isChunkedSource(source)) {
        // Use PDFDataRangeTransport for streaming chunked ranges from IndexedDB
        const RangeTransportClass = pdfjsLib.PDFDataRangeTransport;
        const transport = new RangeTransportClass(source.length, new Uint8Array(0));
        transport.requestDataRange = (begin: number, end: number) => {
          void source
            .getRange(begin, end)
            .then((chunkBytes) => {
              transport.onDataRange(begin, chunkBytes);
            })
            .catch(() => {
              // Range error handled by loading task
            });
        };

        const loadingTask = pdfjsLib.getDocument({
          range: transport,
          cMapPacked: true,
        });

        const pdfDoc = await loadingTask.promise;
        return new PdfJsDocumentHandle(pdfDoc);
      }

      const buffer =
        source instanceof Blob ? await source.arrayBuffer() : source.slice(0);
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        cMapPacked: true,
      });

      const pdfDoc = await loadingTask.promise;
      return new PdfJsDocumentHandle(pdfDoc);
    } catch (err: unknown) {
      const errorObj = err as { name?: string; message?: string };
      if (errorObj?.name === 'PasswordException') {
        throw createAppError(
          'PASSWORD_PROTECTED_PDF',
          'Document protégé par mot de passe',
          'Ce fichier PDF est chiffré par un mot de passe. Veuillez importer une version déverrouillée.'
        );
      }
      throw createAppError(
        'CORRUPTED_PDF',
        'Fichier PDF invalide ou corrompu',
        errorObj?.message
          ? `Impossible d’analyser la structure PDF (${errorObj.message}).`
          : 'Le fichier sélectionné ne semble pas être un document PDF valide.'
      );
    }
  }

  public async extractCoverAndMetadata(
    source: Blob | ArrayBuffer,
    fallbackTitle: string
  ): Promise<{
    readonly title: string;
    readonly author: string;
    readonly totalPages: number;
    readonly coverDataUrl: string;
  }> {
    const handle = await this.loadDocument(source);
    const offscreenCanvas = document.createElement('canvas');

    try {
      const metadata = await handle.getMetadata();
      await handle.renderPageToCanvas({
        pageNumber: 1,
        canvas: offscreenCanvas,
        scale: COVER_THUMBNAIL_SCALE,
        devicePixelRatio: 1.5,
      });

      const coverDataUrl = offscreenCanvas.toDataURL(
        'image/jpeg',
        COVER_JPEG_QUALITY
      );

      const cleanedFallback = fallbackTitle
        .replace(/\.pdf$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();

      return {
        title: metadata.title || cleanedFallback || 'Ouvrage sans titre',
        author: metadata.author || 'Auteur non spécifié',
        totalPages: metadata.totalPages,
        coverDataUrl,
      };
    } finally {
      offscreenCanvas.width = 0;
      offscreenCanvas.height = 0;
      await handle.destroy();
    }
  }
}
