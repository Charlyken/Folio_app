/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { useReader } from '../../../application/useReader';
import { ReaderTheme } from '../../../domain/entities/ReadingSession';
import { IBookRepository } from '../../../domain/repositories/IBookRepository';
import { IPdfEngine } from '../../../domain/services/IPdfEngine';
import { ReaderCanvas } from './ReaderCanvas';
import { ReaderControls } from './ReaderControls';

export interface ReaderViewProps {
  readonly bookId: string;
  readonly repository: IBookRepository;
  readonly pdfEngine: IPdfEngine;
  readonly onBackToLibrary: () => void;
}

const DISTRACTION_FREE_IDLE_MS = 6000;

function getReaderBackdropClass(theme: ReaderTheme): string {
  switch (theme) {
    case 'light':
      return 'bg-[#F3F1EC] text-stone-900';
    case 'sepia':
      return 'bg-[#EAE0C8] text-[#2C221E]';
    case 'dark':
      return 'bg-[#121211] text-stone-100';
  }
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  bookId,
  repository,
  pdfEngine,
  onBackToLibrary,
}) => {
  const reader = useReader(bookId, repository, pdfEngine);
  const {
    readerState,
    session,
    visiblePages,
    progressPercentage,
    remainingPercentage,
    readingTimeSummary,
    isCurrentPageBookmarked,
    canGoPrevious,
    canGoNext,
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
    exportNotesAsMarkdown,
    exportNotesAsJson,
    importNotesFromJson,
  } = reader;

  const [isChromeVisible, setIsChromeVisible] = useState<boolean>(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const idleTimerRef = useRef<number | null>(null);

  const scheduleAutoHideChrome = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      if (!isDrawerOpen) {
        setIsChromeVisible(false);
      }
    }, DISTRACTION_FREE_IDLE_MS);
  }, [isDrawerOpen]);

  const revealChrome = useCallback(() => {
    setIsChromeVisible(true);
    scheduleAutoHideChrome();
  }, [scheduleAutoHideChrome]);

  const handleCenterTap = useCallback(() => {
    setIsChromeVisible((prev) => {
      const next = !prev;
      if (next) {
        scheduleAutoHideChrome();
      }
      return next;
    });
  }, [scheduleAutoHideChrome]);

  useEffect(() => {
    scheduleAutoHideChrome();
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [scheduleAutoHideChrome]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const y = event.clientY;
      const vh = window.innerHeight;
      if (y <= 110 || y >= vh - 110 || isChromeVisible) {
        revealChrome();
      }
    },
    [revealChrome, isChromeVisible]
  );

  const backdropClass = getReaderBackdropClass(session.theme);

  if (readerState.status === 'loading' || readerState.status === 'idle') {
    return (
      <div
        className={`min-h-screen flex flex-col items-center justify-center p-6 ${backdropClass}`}
      >
        <Loader2 className="w-8 h-8 animate-spin text-[#9A3412] mb-4" />
        <p className="font-serif text-2xl font-medium">
          {readerState.status === 'loading'
            ? readerState.message
            : 'Initialisation de la liseuse…'}
        </p>
      </div>
    );
  }

  if (readerState.status === 'error') {
    return (
      <div
        className={`min-h-screen flex flex-col items-center justify-center p-6 ${backdropClass}`}
      >
        <div
          role="alert"
          className="max-w-md w-full p-8 border border-red-800/30 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-center"
        >
          <AlertCircle className="w-10 h-10 text-red-700 mx-auto mb-3" />
          <h1 className="font-serif text-2xl font-semibold">
            {readerState.error.title}
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400 mt-2">
            {readerState.error.message}
          </p>
          <button
            type="button"
            onClick={onBackToLibrary}
            className="mt-6 px-5 py-2.5 text-xs font-semibold text-white bg-[#1C1917] hover:bg-[#9A3412] transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retourner à la bibliothèque</span>
          </button>
        </div>
      </div>
    );
  }

  const { book, documentHandle, outline } = readerState.data;

  return (
    <div
      onMouseMove={handleMouseMove}
      data-testid="reader-view-container"
      data-theme={session.theme}
      data-view-mode={session.viewMode}
      data-auto-crop={String(session.autoCropMargins)}
      data-current-page={session.currentPage}
      className={`min-h-screen w-full flex flex-col transition-colors duration-200 ${backdropClass}`}
    >
      <ReaderControls
        documentHandle={documentHandle}
        bookTitle={book.title}
        bookAuthor={book.author}
        currentPage={session.currentPage}
        visiblePages={visiblePages}
        totalPages={documentHandle.totalPages}
        progressPercentage={progressPercentage}
        remainingPercentage={remainingPercentage}
        readingTimeSummary={readingTimeSummary}
        zoomLevel={session.zoomLevel}
        theme={session.theme}
        viewMode={session.viewMode}
        autoCropMargins={session.autoCropMargins}
        bookmarks={session.bookmarks}
        annotations={session.annotations}
        isCurrentPageBookmarked={isCurrentPageBookmarked}
        outline={outline}
        isChromeVisible={isChromeVisible}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => {
          setIsDrawerOpen((prev) => !prev);
          setIsChromeVisible(true);
        }}
        onCloseDrawer={() => setIsDrawerOpen(false)}
        onBackToLibrary={onBackToLibrary}
        onGoToPage={goToPage}
        onSetTheme={setTheme}
        onSetViewMode={setViewMode}
        onToggleAutoCropMargins={toggleAutoCropMargins}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoomLevel}
        onToggleBookmarkCurrent={toggleBookmarkOnCurrentPage}
        onToggleBookmarkPage={toggleBookmarkOnPage}
        onAddAnnotation={addAnnotation}
        onRemoveAnnotation={removeAnnotation}
        onExportMarkdown={exportNotesAsMarkdown}
        onExportJson={exportNotesAsJson}
        onImportJson={importNotesFromJson}
        onChromeInteraction={revealChrome}
      />

      <main className="flex-1 flex flex-col items-center justify-center pt-14 pb-20">
        <ReaderCanvas
          documentHandle={documentHandle}
          visiblePages={visiblePages}
          zoomLevel={session.zoomLevel}
          theme={session.theme}
          viewMode={session.viewMode}
          autoCropMargins={session.autoCropMargins}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          onPreviousPage={goToPreviousPage}
          onNextPage={goToNextPage}
          onCenterTap={handleCenterTap}
        />
      </main>
    </div>
  );
};
