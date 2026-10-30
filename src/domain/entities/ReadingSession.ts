/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderViewMode = 'single' | 'double';
export type HighlightColor = 'amber' | 'terracotta' | 'lapis';

export interface HighlightRect {
  readonly xRatio: number; // Normalized [0..1] relative to page width
  readonly yRatio: number; // Normalized [0..1] relative to page height
  readonly widthRatio: number; // Normalized [0..1]
  readonly heightRatio: number; // Normalized [0..1]
}

export interface ReaderHighlight {
  readonly id: string;
  readonly pageNumber: number;
  readonly text: string;
  readonly color: HighlightColor;
  readonly rects: readonly HighlightRect[];
  readonly createdAt: number;
}

export interface ReaderAnnotation {
  readonly id: string;
  readonly pageNumber: number;
  readonly note: string;
  readonly quotedText?: string;
  readonly createdAt: number;
  readonly color: HighlightColor;
}

export interface ReadingSession {
  readonly bookId: string;
  readonly currentPage: number;
  readonly zoomLevel: number;
  readonly theme: ReaderTheme;
  readonly viewMode: ReaderViewMode;
  readonly autoCropMargins: boolean;
  readonly averageSecondsPerPage: number;
  readonly bookmarks: readonly number[];
  readonly annotations: readonly ReaderAnnotation[];
  readonly highlights: readonly ReaderHighlight[];
  readonly updatedAt: number;
}

export const DEFAULT_ZOOM_LEVEL = 1.0;
export const MIN_ZOOM_LEVEL = 0.6;
export const MAX_ZOOM_LEVEL = 2.4;
export const ZOOM_STEP = 0.15;
export const DEFAULT_SECONDS_PER_PAGE = 45;

export function createInitialReadingSession(bookId: string): ReadingSession {
  return {
    bookId,
    currentPage: 1,
    zoomLevel: DEFAULT_ZOOM_LEVEL,
    theme: 'sepia',
    viewMode: 'single',
    autoCropMargins: false,
    averageSecondsPerPage: DEFAULT_SECONDS_PER_PAGE,
    bookmarks: [],
    annotations: [],
    highlights: [],
    updatedAt: Date.now(),
  };
}
