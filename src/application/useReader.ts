/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppError,
  AsyncState,
  createAppError,
} from '../domain/entities/AsyncState';
import { Book } from '../domain/entities/Book';
import {
  createInitialReadingSession,
  HighlightColor,
  HighlightRect,
  ReaderAnnotation,
  ReaderHighlight,
  ReaderTheme,
  ReaderViewMode,
  ReadingSession,
} from '../domain/entities/ReadingSession';
import {
  BookSearchIndex,
  SearchMatchSnippet,
} from '../domain/entities/SearchIndex';
import { IBookRepository } from '../domain/repositories/IBookRepository';
import {
  IPdfDocumentHandle,
  IPdfEngine,
  PdfOutlineItem,
} from '../domain/services/IPdfEngine';
import {
  buildBookSearchIndex,
  calculateProgressPercentage,
  calculateRemainingPercentage,
  estimateReadingTimeRemaining,
  generateReadingNotesMarkdown,
  getNextPageNumber,
  getPrefetchPageNumber,
  getPreviousPageNumber,
  getVisiblePageNumbers,
  normalizeTargetPage,
  parseStudySheetJson,
  queryBookSearchIndex,
  resetZoom,
  serializeStudySheetJson,
  stepZoomIn,
  stepZoomOut,
  togglePageBookmark,
  updateRollingReadingPace,
} from '../domain/services/ReadingRules';

const PROGRESS_SAVE_DEBOUNCE_MS = 350;

export interface LoadedReaderData {
  readonly book: Book;
  readonly documentHandle: IPdfDocumentHandle;
  readonly outline: readonly PdfOutlineItem[];
}

export interface UseReaderResult {
  readonly readerState: AsyncState<LoadedReaderData>;
  readonly session: ReadingSession;
  readonly visiblePages: readonly number[];
  readonly progressPercentage: number;
  readonly remainingPercentage: number;
  readonly readingTimeSummary: string;
  readonly isCurrentPageBookmarked: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly searchQuery: string;
  readonly searchResults: readonly SearchMatchSnippet[];
  readonly searchDurationMs: number;
  readonly isIndexingSearch: boolean;
  readonly setSearchQuery: (query: string) => void;
  readonly goToNextPage: () => void;
  readonly goToPreviousPage: () => void;
  readonly goToPage: (pageNumber: number) => void;
  readonly setTheme: (theme: ReaderTheme) => void;
  readonly setViewMode: (viewMode: ReaderViewMode) => void;
  readonly toggleAutoCropMargins: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoomLevel: () => void;
  readonly toggleBookmarkOnCurrentPage: () => void;
  readonly toggleBookmarkOnPage: (pageNumber: number) => void;
  readonly addAnnotation: (
    note: string,
    color?: HighlightColor,
    quotedText?: string,
    pageNumber?: number
  ) => void;
  readonly removeAnnotation: (annotationId: string) => void;
  readonly addHighlight: (
    pageNumber: number,
    text: string,
    color: HighlightColor,
    rects: readonly HighlightRect[]
  ) => void;
  readonly removeHighlight: (highlightId: string) => void;
  readonly exportNotesAsMarkdown: () => void;
  readonly exportNotesAsJson: () => void;
  readonly importNotesFromJson: (rawJson: string) => {
    readonly success: boolean;
    readonly message: string;
  };
}

export function useReader(
  bookId: string,
  repository: IBookRepository,
  pdfEngine: IPdfEngine
): UseReaderResult {
  const [readerState, setReaderState] = useState<AsyncState<LoadedReaderData>>({
    status: 'loading',
    message: 'Ouverture de l’ouvrage et préparation du rendu haute résolution…',
  });

  const [session, setSession] = useState<ReadingSession>(() =>
    createInitialReadingSession(bookId)
  );

  const [searchIndex, setSearchIndex] = useState<BookSearchIndex | null>(null);
  const [isIndexingSearch, setIsIndexingSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const activeHandleRef = useRef<IPdfDocumentHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestSessionRef = useRef<ReadingSession>(session);
  latestSessionRef.current = session;

  const pageEnteredAtRef = useRef<number>(Date.now());

  // Load book metadata, reading session, search index, and binary PDF document
  useEffect(() => {
    let isCancelled = false;

    async function loadBookAndSession() {
      setReaderState({
        status: 'loading',
        message: 'Ouverture de l’ouvrage…',
      });

      try {
        const [bookMeta, blob, savedSession, persistedSearchIndex] =
          await Promise.all([
            repository.getBookMetadata(bookId),
            repository.getBookBlob(bookId),
            repository.getReadingSession(bookId),
            repository.getBookSearchIndex(bookId),
          ]);

        if (!bookMeta || !blob) {
          throw createAppError(
            'BOOK_NOT_FOUND',
            'Ouvrage introuvable',
            'Ce livre a été supprimé ou n’est plus présent dans le stockage local.'
          );
        }

        const docHandle = await pdfEngine.loadDocument(blob);

        if (isCancelled) {
          await docHandle.destroy();
          return;
        }

        const outline = await docHandle.extractOutline();

        if (isCancelled) {
          await docHandle.destroy();
          return;
        }

        activeHandleRef.current = docHandle;

        const normalizedStartPage = normalizeTargetPage(
          savedSession.currentPage,
          docHandle.totalPages,
          savedSession.viewMode
        );

        const hydratedSession: ReadingSession = {
          ...savedSession,
          highlights: savedSession.highlights ?? [],
          currentPage: normalizedStartPage,
        };

        pageEnteredAtRef.current = Date.now();
        setSession(hydratedSession);
        setReaderState({
          status: 'success',
          data: {
            book: bookMeta,
            documentHandle: docHandle,
            outline,
          },
        });

        // Hydrate or asynchronously build the full-text inverted search index (`books_search_index`)
        if (persistedSearchIndex && persistedSearchIndex.pages.length > 0) {
          setSearchIndex(persistedSearchIndex);
        } else {
          setIsIndexingSearch(true);
          void docHandle
            .extractAllPagesPlainText()
            .then(async (pagesText) => {
              if (isCancelled) return;
              const builtIndex = buildBookSearchIndex(bookId, pagesText);
              setSearchIndex(builtIndex);
              await repository.saveBookSearchIndex(builtIndex);
            })
            .finally(() => {
              if (!isCancelled) {
                setIsIndexingSearch(false);
              }
            });
        }
      } catch (err: unknown) {
        if (isCancelled) return;
        const appErr: AppError =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          'title' in err &&
          'message' in err
            ? (err as AppError)
            : createAppError(
                'CORRUPTED_PDF',
                'Impossible d’ouvrir le livre',
                err instanceof Error
                  ? err.message
                  : 'Une erreur est survenue lors du chargement du PDF.'
              );
        setReaderState({ status: 'error', error: appErr });
      }
    }

    void loadBookAndSession();

    return () => {
      isCancelled = true;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void repository.updateReadingProgress(latestSessionRef.current);

      if (activeHandleRef.current) {
        const handleToDestroy = activeHandleRef.current;
        activeHandleRef.current = null;
        void handleToDestroy.destroy();
      }
    };
  }, [bookId, repository, pdfEngine]);

  // Execute sub-20ms full-text query against the inverted search index
  const { searchResults, searchDurationMs } = useMemo(() => {
    if (!searchIndex || searchQuery.trim().length < 2) {
      return { searchResults: [] as readonly SearchMatchSnippet[], searchDurationMs: 0 };
    }
    const t0 = performance.now();
    const matches = queryBookSearchIndex(searchIndex, searchQuery);
    const elapsed = Math.max(0.1, Math.round((performance.now() - t0) * 10) / 10);
    return { searchResults: matches, searchDurationMs: elapsed };
  }, [searchIndex, searchQuery]);

  const scheduleSessionPersistence = useCallback(
    (nextSession: ReadingSession) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void repository.updateReadingProgress(nextSession);
        saveTimerRef.current = null;
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
    [repository]
  );

  const totalPages =
    readerState.status === 'success'
      ? readerState.data.documentHandle.totalPages
      : 1;

  useEffect(() => {
    if (readerState.status !== 'success') return;
    const prefetchPage = getPrefetchPageNumber(
      session.currentPage,
      readerState.data.documentHandle.totalPages,
      session.viewMode
    );
    if (prefetchPage !== null) {
      void readerState.data.documentHandle.prefetchPage(prefetchPage);
    }
  }, [readerState, session.currentPage, session.viewMode]);

  const updateSession = useCallback(
    (updater: (prev: ReadingSession) => ReadingSession) => {
      setSession((prev) => {
        const updated = updater(prev);
        scheduleSessionPersistence(updated);
        return updated;
      });
    },
    [scheduleSessionPersistence]
  );

  const recordDwellAndNavigate = useCallback(
    (computeNextPage: (prev: ReadingSession) => number) => {
      const now = Date.now();
      const dwellSeconds = (now - pageEnteredAtRef.current) / 1000;
      pageEnteredAtRef.current = now;

      updateSession((prev) => {
        const nextPage = computeNextPage(prev);
        const updatedPace =
          nextPage !== prev.currentPage
            ? updateRollingReadingPace(prev.averageSecondsPerPage, dwellSeconds)
            : prev.averageSecondsPerPage;
        return {
          ...prev,
          currentPage: nextPage,
          averageSecondsPerPage: updatedPace,
        };
      });
    },
    [updateSession]
  );

  const goToPage = useCallback(
    (targetPage: number) => {
      recordDwellAndNavigate((prev) =>
        normalizeTargetPage(targetPage, totalPages, prev.viewMode)
      );
    },
    [totalPages, recordDwellAndNavigate]
  );

  const goToNextPage = useCallback(() => {
    recordDwellAndNavigate((prev) =>
      getNextPageNumber(prev.currentPage, totalPages, prev.viewMode)
    );
  }, [totalPages, recordDwellAndNavigate]);

  const goToPreviousPage = useCallback(() => {
    recordDwellAndNavigate((prev) =>
      getPreviousPageNumber(prev.currentPage, totalPages, prev.viewMode)
    );
  }, [totalPages, recordDwellAndNavigate]);

  const setTheme = useCallback(
    (theme: ReaderTheme) => {
      updateSession((prev) => ({ ...prev, theme }));
    },
    [updateSession]
  );

  const setViewMode = useCallback(
    (viewMode: ReaderViewMode) => {
      updateSession((prev) => ({
        ...prev,
        viewMode,
        currentPage: normalizeTargetPage(
          prev.currentPage,
          totalPages,
          viewMode
        ),
      }));
    },
    [totalPages, updateSession]
  );

  const toggleAutoCropMargins = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      autoCropMargins: !prev.autoCropMargins,
    }));
  }, [updateSession]);

  const zoomIn = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: stepZoomIn(prev.zoomLevel),
    }));
  }, [updateSession]);

  const zoomOut = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: stepZoomOut(prev.zoomLevel),
    }));
  }, [updateSession]);

  const resetZoomLevel = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: resetZoom(),
    }));
  }, [updateSession]);

  const toggleBookmarkOnPage = useCallback(
    (pageNumber: number) => {
      const clamped = Math.max(1, Math.min(pageNumber, totalPages));
      updateSession((prev) => ({
        ...prev,
        bookmarks: togglePageBookmark(prev.bookmarks, clamped),
      }));
    },
    [totalPages, updateSession]
  );

  const toggleBookmarkOnCurrentPage = useCallback(() => {
    toggleBookmarkOnPage(session.currentPage);
  }, [session.currentPage, toggleBookmarkOnPage]);

  const addAnnotation = useCallback(
    (
      note: string,
      color: HighlightColor = 'amber',
      quotedText?: string,
      pageNumber?: number
    ) => {
      const trimmed = note.trim();
      if (!trimmed) return;
      const newAnnotation: ReaderAnnotation = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber: pageNumber ?? session.currentPage,
        note: trimmed,
        quotedText: quotedText?.trim() || undefined,
        createdAt: Date.now(),
        color,
      };
      updateSession((prev) => ({
        ...prev,
        annotations: [newAnnotation, ...prev.annotations],
      }));
    },
    [session.currentPage, updateSession]
  );

  const removeAnnotation = useCallback(
    (annotationId: string) => {
      updateSession((prev) => ({
        ...prev,
        annotations: prev.annotations.filter((a) => a.id !== annotationId),
      }));
    },
    [updateSession]
  );

  const addHighlight = useCallback(
    (
      pageNumber: number,
      text: string,
      color: HighlightColor,
      rects: readonly HighlightRect[]
    ) => {
      const trimmed = text.trim();
      if (!trimmed || rects.length === 0) return;
      const newHighlight: ReaderHighlight = {
        id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        text: trimmed,
        color,
        rects,
        createdAt: Date.now(),
      };
      updateSession((prev) => ({
        ...prev,
        highlights: [...(prev.highlights ?? []), newHighlight],
      }));
    },
    [updateSession]
  );

  const removeHighlight = useCallback(
    (highlightId: string) => {
      updateSession((prev) => ({
        ...prev,
        highlights: (prev.highlights ?? []).filter((h) => h.id !== highlightId),
      }));
    },
    [updateSession]
  );

  const triggerBrowserDownload = useCallback(
    (content: string, filename: string, mimeType: string) => {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },
    []
  );

  const exportNotesAsMarkdown = useCallback(() => {
    if (readerState.status !== 'success') return;
    const { book, outline } = readerState.data;
    const markdown = generateReadingNotesMarkdown(
      book,
      session.bookmarks,
      session.annotations,
      outline,
      session.highlights ?? []
    );
    const safeSlug = book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    triggerBrowserDownload(
      markdown,
      `fiche-lecture-${safeSlug || 'folio'}.md`,
      'text/markdown;charset=utf-8'
    );
  }, [
    readerState,
    session.bookmarks,
    session.annotations,
    session.highlights,
    triggerBrowserDownload,
  ]);

  const exportNotesAsJson = useCallback(() => {
    if (readerState.status !== 'success') return;
    const { book } = readerState.data;
    const json = serializeStudySheetJson(
      book.title,
      session.bookmarks,
      session.annotations,
      session.highlights ?? []
    );
    const safeSlug = book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    triggerBrowserDownload(
      json,
      `notes-${safeSlug || 'folio'}.json`,
      'application/json;charset=utf-8'
    );
  }, [
    readerState,
    session.bookmarks,
    session.annotations,
    session.highlights,
    triggerBrowserDownload,
  ]);

  const importNotesFromJson = useCallback(
    (rawJson: string): { readonly success: boolean; readonly message: string } => {
      try {
        const imported = parseStudySheetJson(rawJson, totalPages);
        updateSession((prev) => {
          const mergedBookmarks = Array.from(
            new Set([...prev.bookmarks, ...imported.bookmarks])
          ).sort((a, b) => a - b);

          const existingNoteIds = new Set(prev.annotations.map((a) => a.id));
          const newNotes = imported.annotations.filter(
            (a) => !existingNoteIds.has(a.id)
          );

          const existingHlIds = new Set(
            (prev.highlights ?? []).map((h) => h.id)
          );
          const newHighlights = imported.highlights.filter(
            (h) => !existingHlIds.has(h.id)
          );

          return {
            ...prev,
            bookmarks: mergedBookmarks,
            annotations: [...newNotes, ...prev.annotations],
            highlights: [...(prev.highlights ?? []), ...newHighlights],
          };
        });
        return {
          success: true,
          message: `${imported.bookmarks.length} signet(s), ${imported.highlights.length} surlignage(s) et ${imported.annotations.length} note(s) importés.`,
        };
      } catch {
        return {
          success: false,
          message:
            'Le fichier JSON sélectionné ne correspond pas au format de fiche de lecture Folio.',
        };
      }
    },
    [totalPages, updateSession]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToNextPage();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPreviousPage();
      } else if (event.key === ' ') {
        event.preventDefault();
        if (event.shiftKey) {
          goToPreviousPage();
        } else {
          goToNextPage();
        }
      } else if (event.key === '+' || event.key === '=') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          zoomIn();
        }
      } else if (event.key === '-') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          zoomOut();
        }
      } else if (event.key === 'b' || event.key === 'B') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          toggleBookmarkOnCurrentPage();
        }
      } else if (event.key === 'c' || event.key === 'C') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          toggleAutoCropMargins();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    goToNextPage,
    goToPreviousPage,
    zoomIn,
    zoomOut,
    toggleBookmarkOnCurrentPage,
    toggleAutoCropMargins,
  ]);

  const visiblePages = getVisiblePageNumbers(
    session.currentPage,
    totalPages,
    session.viewMode
  );
  const lastVisiblePage =
    visiblePages[visiblePages.length - 1] ?? session.currentPage;

  const progressPercentage = calculateProgressPercentage(
    lastVisiblePage,
    totalPages
  );
  const remainingPercentage = calculateRemainingPercentage(
    lastVisiblePage,
    totalPages
  );

  const outline =
    readerState.status === 'success' ? readerState.data.outline : [];

  const readingTimeSummary = estimateReadingTimeRemaining(
    lastVisiblePage,
    totalPages,
    outline,
    session.averageSecondsPerPage
  ).formattedSummary;

  const isCurrentPageBookmarked = visiblePages.some((p) =>
    session.bookmarks.includes(p)
  );

  const canGoPrevious = session.currentPage > 1;
  const canGoNext = lastVisiblePage < totalPages;

  return {
    readerState,
    session,
    visiblePages,
    progressPercentage,
    remainingPercentage,
    readingTimeSummary,
    isCurrentPageBookmarked,
    canGoPrevious,
    canGoNext,
    searchQuery,
    searchResults,
    searchDurationMs,
    isIndexingSearch,
    setSearchQuery,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    setTheme,
    setViewMode,
    toggleAutoCropMargins,
    zoomIn,
    zoomOut,
    resetZoomLevel,
    toggleBookmarkOnCurrentPage,
    toggleBookmarkOnPage,
    addAnnotation,
    removeAnnotation,
    addHighlight,
    removeHighlight,
    exportNotesAsMarkdown,
    exportNotesAsJson,
    importNotesFromJson,
  };
}
