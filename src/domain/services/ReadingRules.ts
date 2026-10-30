/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book } from '../entities/Book';
import {
  DEFAULT_SECONDS_PER_PAGE,
  DEFAULT_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ReaderAnnotation,
  ReaderViewMode,
  ZOOM_STEP,
} from '../entities/ReadingSession';
import { PdfOutlineItem } from './IPdfEngine';

export const MAX_PDF_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB
export const ALLOWED_PDF_MIME_TYPE = 'application/pdf';
export const PDF_CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB chunks for IndexedDB streaming

export const MIN_VALID_PAGE_DWELL_SECONDS = 4;
export const MAX_VALID_PAGE_DWELL_SECONDS = 300;

/**
 * Calculates the reading progress percentage between 0 and 100.
 */
export function calculateProgressPercentage(currentPage: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages));
  if (totalPages === 1) return 100;
  return Math.round((clampedPage / totalPages) * 100);
}

/**
 * Calculates the remaining percentage of the book.
 */
export function calculateRemainingPercentage(currentPage: number, totalPages: number): number {
  const progress = calculateProgressPercentage(currentPage, totalPages);
  return Math.max(0, 100 - progress);
}

/**
 * Clamps a target page number within valid [1, totalPages] bounds.
 * In double-page mode, aligns spreads as [1, 2], [3, 4], [5, 6] so odd pages are always on the left.
 */
export function normalizeTargetPage(
  targetPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  if (totalPages <= 0) return 1;
  const clamped = Math.max(1, Math.min(Math.floor(targetPage), totalPages));
  if (viewMode === 'double' && clamped > 1 && clamped % 2 === 0) {
    return clamped - 1;
  }
  return clamped;
}

/**
 * Computes the next page number based on current page, total pages, and viewMode.
 */
export function getNextPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  const step = viewMode === 'double' ? 2 : 1;
  const candidate = currentPage + step;
  if (candidate > totalPages) {
    return normalizeTargetPage(totalPages, totalPages, viewMode);
  }
  return normalizeTargetPage(candidate, totalPages, viewMode);
}

/**
 * Computes the previous page number based on current page, total pages, and viewMode.
 */
export function getPreviousPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  const step = viewMode === 'double' ? 2 : 1;
  const candidate = currentPage - step;
  return normalizeTargetPage(Math.max(1, candidate), totalPages, viewMode);
}

/**
 * Returns the pair of pages currently visible in the reader.
 */
export function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): readonly number[] {
  const normalized = normalizeTargetPage(currentPage, totalPages, viewMode);
  if (viewMode === 'single') {
    return [normalized];
  }
  const secondPage = normalized + 1;
  if (secondPage <= totalPages) {
    return [normalized, secondPage];
  }
  return [normalized];
}

/**
 * Computes the next page to prefetch in memory.
 */
export function getPrefetchPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number | null {
  const visible = getVisiblePageNumbers(currentPage, totalPages, viewMode);
  const lastVisible = visible[visible.length - 1];
  if (lastVisible !== undefined && lastVisible + 1 <= totalPages) {
    return lastVisible + 1;
  }
  return null;
}

/**
 * Toggles a page number in the sorted list of bookmarks.
 */
export function togglePageBookmark(
  bookmarks: readonly number[],
  pageNumber: number
): readonly number[] {
  const exists = bookmarks.includes(pageNumber);
  if (exists) {
    return bookmarks.filter((p) => p !== pageNumber);
  }
  return [...bookmarks, pageNumber].sort((a, b) => a - b);
}

/**
 * Clamps and rounds zoom level within [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL].
 */
export function clampZoomLevel(zoom: number): number {
  const clamped = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, zoom));
  return Math.round(clamped * 100) / 100;
}

export function stepZoomIn(currentZoom: number): number {
  return clampZoomLevel(currentZoom + ZOOM_STEP);
}

export function stepZoomOut(currentZoom: number): number {
  return clampZoomLevel(currentZoom - ZOOM_STEP);
}

export function resetZoom(): number {
  return DEFAULT_ZOOM_LEVEL;
}

/**
 * Formats byte size into human-readable French string (e.g., "2,4 Mo").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} Ko`;
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Updates the rolling reading speed (averageSecondsPerPage) using an Exponential Moving Average (EMA),
 * ignoring idle pauses (> 300s) or rapid page flips (< 4s).
 */
export function updateRollingReadingPace(
  previousAvgSeconds: number,
  observedDwellSeconds: number
): number {
  const base = previousAvgSeconds > 0 ? previousAvgSeconds : DEFAULT_SECONDS_PER_PAGE;
  if (
    observedDwellSeconds < MIN_VALID_PAGE_DWELL_SECONDS ||
    observedDwellSeconds > MAX_VALID_PAGE_DWELL_SECONDS
  ) {
    return base;
  }
  const blended = base * 0.7 + observedDwellSeconds * 0.3;
  return Math.max(8, Math.min(180, Math.round(blended)));
}

/**
 * Estimates remaining reading time in seconds for both the current chapter and the entire book.
 */
export function estimateReadingTimeRemaining(
  currentPage: number,
  totalPages: number,
  outline: readonly PdfOutlineItem[],
  averageSecondsPerPage: number
): {
  readonly bookRemainingSeconds: number;
  readonly chapterRemainingSeconds: number | null;
  readonly currentChapterTitle: string | null;
  readonly formattedSummary: string;
} {
  const pace = averageSecondsPerPage > 0 ? averageSecondsPerPage : DEFAULT_SECONDS_PER_PAGE;
  const remainingBookPages = Math.max(0, totalPages - currentPage);
  const bookRemainingSeconds = remainingBookPages * pace;

  // Flatten top-level outline sorted by pageNumber
  const sortedOutline = [...outline].sort((a, b) => a.pageNumber - b.pageNumber);
  let currentChapter: PdfOutlineItem | null = null;
  let nextChapterPage: number | null = null;

  for (let i = 0; i < sortedOutline.length; i++) {
    const item = sortedOutline[i];
    if (item.pageNumber <= currentPage) {
      currentChapter = item;
      nextChapterPage =
        i + 1 < sortedOutline.length ? sortedOutline[i + 1].pageNumber : totalPages + 1;
    } else if (currentChapter === null && item.pageNumber > currentPage) {
      nextChapterPage = item.pageNumber;
      break;
    }
  }

  let chapterRemainingSeconds: number | null = null;
  if (nextChapterPage !== null) {
    const pagesLeftInChapter = Math.max(0, nextChapterPage - currentPage);
    chapterRemainingSeconds = pagesLeftInChapter * pace;
  }

  const bookStr = formatDurationFrench(bookRemainingSeconds);
  const formattedSummary =
    chapterRemainingSeconds !== null && sortedOutline.length > 0
      ? `~${formatDurationFrench(chapterRemainingSeconds)} dans ce chapitre · ${bookStr} dans l’ouvrage`
      : `~${bookStr} restantes dans l’ouvrage`;

  return {
    bookRemainingSeconds,
    chapterRemainingSeconds,
    currentChapterTitle: currentChapter?.title ?? null,
    formattedSummary,
  };
}

export function formatDurationFrench(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Terminé';
  if (totalSeconds < 60) return '< 1 min';
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${String(mins).padStart(2, '0')}` : `${hours}h`;
}

/**
 * Generates a structured editorial Markdown study sheet containing all bookmarks and annotations
 * grouped by chapter.
 */
export function generateReadingNotesMarkdown(
  book: Pick<Book, 'title' | 'author' | 'totalPages'>,
  bookmarks: readonly number[],
  annotations: readonly ReaderAnnotation[],
  outline: readonly PdfOutlineItem[]
): string {
  const lines: string[] = [
    `# Fiche de Lecture — ${book.title}`,
    ``,
    `- **Auteur** : ${book.author}`,
    `- **Longueur** : ${book.totalPages} pages`,
    `- **Signets enregistrés** : ${bookmarks.length}`,
    `- **Notes & Annotations** : ${annotations.length}`,
    ``,
    `---`,
    ``,
  ];

  // Resolve chapter name helper
  const sortedOutline = [...outline].sort((a, b) => a.pageNumber - b.pageNumber);
  const findChapterForPage = (pageNum: number): string => {
    let chapterTitle = 'Introduction / Hors-chapitre';
    for (const item of sortedOutline) {
      if (item.pageNumber <= pageNum) {
        chapterTitle = item.title;
      } else {
        break;
      }
    }
    return chapterTitle;
  };

  lines.push(`## Signets de Pages (${bookmarks.length})`);
  lines.push(``);
  if (bookmarks.length === 0) {
    lines.push(`_Aucun signet enregistré._`);
  } else {
    for (const pageNum of bookmarks) {
      const chap = sortedOutline.length > 0 ? ` — _${findChapterForPage(pageNum)}_` : '';
      lines.push(`- **Page ${pageNum}** (${Math.round((pageNum / book.totalPages) * 100)}%)${chap}`);
    }
  }
  lines.push(``);

  lines.push(`## Annotations & Réflexions (${annotations.length})`);
  lines.push(``);
  if (annotations.length === 0) {
    lines.push(`_Aucune annotation enregistrée._`);
  } else {
    const sortedNotes = [...annotations].sort((a, b) => a.pageNumber - b.pageNumber);
    for (const note of sortedNotes) {
      const chap = sortedOutline.length > 0 ? ` · ${findChapterForPage(note.pageNumber)}` : '';
      lines.push(`### Page ${note.pageNumber}${chap}`);
      lines.push(``);
      lines.push(`> ${note.note}`);
      lines.push(``);
    }
  }

  return lines.join('\n');
}

export interface ImportedStudySheetPayload {
  readonly version: 1;
  readonly bookTitle: string;
  readonly bookmarks: readonly number[];
  readonly annotations: readonly ReaderAnnotation[];
}

export function serializeStudySheetJson(
  bookTitle: string,
  bookmarks: readonly number[],
  annotations: readonly ReaderAnnotation[]
): string {
  const payload: ImportedStudySheetPayload = {
    version: 1,
    bookTitle,
    bookmarks,
    annotations,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseStudySheetJson(
  rawJson: string,
  totalPages: number
): {
  readonly bookmarks: readonly number[];
  readonly annotations: readonly ReaderAnnotation[];
} {
  const parsed = JSON.parse(rawJson) as Partial<ImportedStudySheetPayload>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Structure JSON invalide.');
  }

  const rawBookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [];
  const validBookmarks = Array.from(
    new Set(
      rawBookmarks
        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
        .map((p) => Math.max(1, Math.min(Math.floor(p), totalPages)))
    )
  ).sort((a, b) => a - b);

  const rawAnnotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
  const validAnnotations: ReaderAnnotation[] = [];
  for (const item of rawAnnotations) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.note === 'string' &&
      item.note.trim().length > 0 &&
      typeof item.pageNumber === 'number'
    ) {
      validAnnotations.push({
        id:
          typeof item.id === 'string' && item.id.length > 0
            ? item.id
            : `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber: Math.max(1, Math.min(Math.floor(item.pageNumber), totalPages)),
        note: item.note.trim(),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        color:
          item.color === 'terracotta' || item.color === 'lapis' || item.color === 'amber'
            ? item.color
            : 'amber',
      });
    }
  }

  return {
    bookmarks: validBookmarks,
    annotations: validAnnotations,
  };
}

/**
 * Splits a Uint8Array buffer into fixed-size ArrayBuffer chunks (default 2 MB)
 * for streaming storage inside IndexedDB.
 */
export function splitBufferIntoChunks(
  bytes: Uint8Array,
  chunkSizeBytes: number = PDF_CHUNK_SIZE_BYTES
): ArrayBuffer[] {
  if (bytes.byteLength === 0) {
    return [new ArrayBuffer(0)];
  }
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSizeBytes) {
    const end = Math.min(offset + chunkSizeBytes, bytes.byteLength);
    const slice = bytes.slice(offset, end);
    chunks.push(slice.buffer);
  }
  return chunks;
}

/**
 * Extracts an arbitrary byte range [begin, end) from an ordered list of fixed-size chunks.
 */
export function assembleByteRangeFromChunks(
  chunks: readonly ArrayBuffer[],
  chunkSizeBytes: number,
  totalBytes: number,
  begin: number,
  end: number
): Uint8Array {
  const safeBegin = Math.max(0, Math.min(begin, totalBytes));
  const safeEnd = Math.max(safeBegin, Math.min(end, totalBytes));
  const length = safeEnd - safeBegin;
  if (length === 0) {
    return new Uint8Array(0);
  }

  const out = new Uint8Array(length);
  let writeOffset = 0;

  const firstChunkIndex = Math.floor(safeBegin / chunkSizeBytes);
  const lastChunkIndex = Math.floor((safeEnd - 1) / chunkSizeBytes);

  for (let cIdx = firstChunkIndex; cIdx <= lastChunkIndex; cIdx++) {
    const chunkBuf = chunks[cIdx];
    if (!chunkBuf) break;
    const chunkStartGlobal = cIdx * chunkSizeBytes;
    const readStart = Math.max(0, safeBegin - chunkStartGlobal);
    const readEnd = Math.min(chunkBuf.byteLength, safeEnd - chunkStartGlobal);
    if (readEnd > readStart) {
      const view = new Uint8Array(chunkBuf, readStart, readEnd - readStart);
      out.set(view, writeOffset);
      writeOffset += view.byteLength;
    }
  }

  return out;
}

/**
 * Computes a hexadecimal SHA-256 fingerprint of an ArrayBuffer using Web Crypto API.
 */
export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
