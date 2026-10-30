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
  PdfDocumentMetadata,
  PdfOutlineItem,
  RenderPageOptions,
} from '../../domain/services/IPdfEngine';

// Configure Web Worker once so PDF parsing and rasterization never block the Main Thread
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const COVER_THUMBNAIL_SCALE = 0.75;
const COVER_JPEG_QUALITY = 0.85;
const MAX_CACHED_PREFETCH_PAGES = 3;

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
    // Evict oldest cached page if cache exceeds budget (strict Memory Management)
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
    const { pageNumber, canvas, scale } = options;
    const dpr = options.devicePixelRatio ?? Math.min(window.devicePixelRatio || 1, 2.5);

    // Cancel any ongoing render on this specific canvas before starting a new one
    this.cancelActiveRender(canvas);

    const page = await this.getOrLoadPage(pageNumber);
    const cssViewport = page.getViewport({ scale });
    const outputViewport = page.getViewport({ scale: scale * dpr });

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw createAppError(
        'RENDER_FAILED',
        'Erreur graphique Canvas',
        'Impossible d’initialiser le contexte 2D haute résolution.'
      );
    }

    // Set physical HiDPI / Retina pixel dimensions
    canvas.width = Math.floor(outputViewport.width);
    canvas.height = Math.floor(outputViewport.height);
    // Set CSS display dimensions
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;

    // Clear with clean white paper background before rendering PDF glyphs
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({
      canvasContext: context,
      viewport: outputViewport,
      canvas,
    });

    this.activeRenderTasks.set(canvas, renderTask);

    try {
      await renderTask.promise;
    } catch (err: unknown) {
      const errorObj = err as { name?: string };
      if (errorObj?.name === 'RenderingCancelledException') {
        // Expected when user flips pages rapidly
        return;
      }
      throw createAppError(
        'RENDER_FAILED',
        'Échec du rendu de la page',
        `La page ${pageNumber} n’a pas pu être affichée correctement.`
      );
    } finally {
      if (this.activeRenderTasks.get(canvas) === renderTask) {
        this.activeRenderTasks.delete(canvas);
      }
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
        const pageIndex = await this.pdfDoc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
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

export class PdfJsAdapter implements IPdfEngine {
  public async loadDocument(source: Blob | ArrayBuffer): Promise<IPdfDocumentHandle> {
    try {
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
      // Strictly clean up offscreen canvas memory and destroy temporary PDF document handle
      offscreenCanvas.width = 0;
      offscreenCanvas.height = 0;
      await handle.destroy();
    }
  }
}
