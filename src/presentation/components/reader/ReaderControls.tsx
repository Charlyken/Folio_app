/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Clock,
  Columns2,
  Crop,
  Download,
  FileJson,
  FileText,
  List,
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  ReaderAnnotation,
  ReaderTheme,
  ReaderViewMode,
} from '../../../domain/entities/ReadingSession';
import {
  IPdfDocumentHandle,
  PdfOutlineItem,
} from '../../../domain/services/IPdfEngine';

export interface ReaderControlsProps {
  readonly documentHandle: IPdfDocumentHandle;
  readonly bookTitle: string;
  readonly bookAuthor: string;
  readonly currentPage: number;
  readonly visiblePages: readonly number[];
  readonly totalPages: number;
  readonly progressPercentage: number;
  readonly remainingPercentage: number;
  readonly readingTimeSummary: string;
  readonly zoomLevel: number;
  readonly theme: ReaderTheme;
  readonly viewMode: ReaderViewMode;
  readonly autoCropMargins: boolean;
  readonly bookmarks: readonly number[];
  readonly annotations: readonly ReaderAnnotation[];
  readonly isCurrentPageBookmarked: boolean;
  readonly outline: readonly PdfOutlineItem[];
  readonly isChromeVisible: boolean;
  readonly isDrawerOpen: boolean;
  readonly onToggleDrawer: () => void;
  readonly onCloseDrawer: () => void;
  readonly onBackToLibrary: () => void;
  readonly onGoToPage: (pageNumber: number) => void;
  readonly onSetTheme: (theme: ReaderTheme) => void;
  readonly onSetViewMode: (viewMode: ReaderViewMode) => void;
  readonly onToggleAutoCropMargins: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetZoom: () => void;
  readonly onToggleBookmarkCurrent: () => void;
  readonly onToggleBookmarkPage: (pageNumber: number) => void;
  readonly onAddAnnotation: (note: string, color?: ReaderAnnotation['color']) => void;
  readonly onRemoveAnnotation: (annotationId: string) => void;
  readonly onExportMarkdown: () => void;
  readonly onExportJson: () => void;
  readonly onImportJson: (rawJson: string) => {
    readonly success: boolean;
    readonly message: string;
  };
  readonly onChromeInteraction: () => void;
}

type DrawerTab = 'outline' | 'bookmarks' | 'annotations';

export const ReaderControls: React.FC<ReaderControlsProps> = ({
  documentHandle,
  bookTitle,
  bookAuthor,
  currentPage,
  visiblePages,
  totalPages,
  progressPercentage,
  remainingPercentage,
  readingTimeSummary,
  zoomLevel,
  theme,
  viewMode,
  autoCropMargins,
  bookmarks,
  annotations,
  isCurrentPageBookmarked,
  outline,
  isChromeVisible,
  isDrawerOpen,
  onToggleDrawer,
  onCloseDrawer,
  onBackToLibrary,
  onGoToPage,
  onSetTheme,
  onSetViewMode,
  onToggleAutoCropMargins,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleBookmarkCurrent,
  onToggleBookmarkPage,
  onAddAnnotation,
  onRemoveAnnotation,
  onExportMarkdown,
  onExportJson,
  onImportJson,
  onChromeInteraction,
}) => {
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('outline');
  const [noteInput, setNoteInput] = useState<string>('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  // Thumbnail Scrubbing state
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewThumbUrl, setPreviewThumbUrl] = useState<string>('');
  const scrubberContainerRef = useRef<HTMLDivElement | null>(null);

  const surfaceStyles: Record<ReaderTheme, string> = {
    light: 'bg-white/95 text-stone-900 border-stone-200',
    sepia: 'bg-[#F4ECD8]/95 text-[#2C221E] border-[#DFD3B9]',
    dark: 'bg-stone-900/95 text-stone-100 border-stone-800',
  };

  const activeSurface = surfaceStyles[theme];

  // Generate low-overhead thumbnail on the fly when previewPage changes
  useEffect(() => {
    if (previewPage === null) {
      setPreviewThumbUrl('');
      return;
    }

    let isCancelled = false;
    void documentHandle.renderPageThumbnail(previewPage, 132).then((url) => {
      if (!isCancelled && url) {
        setPreviewThumbUrl(url);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [documentHandle, previewPage]);

  const handleScrubberMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = scrubberContainerRef.current;
      if (!container || totalPages <= 1) return;
      const rect = container.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))
      );
      const hoveredPage = Math.max(
        1,
        Math.min(totalPages, Math.round(1 + ratio * (totalPages - 1)))
      );
      setPreviewPage(hoveredPage);
    },
    [totalPages]
  );

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    onAddAnnotation(noteInput.trim(), 'amber');
    setNoteInput('');
  };

  const handleImportFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = onImportJson(text);
      setImportFeedback(res.message);
    } catch {
      setImportFeedback('Impossible de lire le fichier JSON sélectionné.');
    } finally {
      event.target.value = '';
    }
  };

  // Resolve chapter title for previewPage if available
  const getPreviewChapterTitle = (pageNum: number): string | null => {
    let title: string | null = null;
    for (const item of outline) {
      if (item.pageNumber <= pageNum) {
        title = item.title;
      }
    }
    return title;
  };

  return (
    <>
      {/* TOP BAR (Distraction-Free Auto-Fading Chrome) */}
      <header
        onMouseEnter={onChromeInteraction}
        onFocus={onChromeInteraction}
        className={`fixed top-0 inset-x-0 z-30 border-b px-4 sm:px-8 py-3 flex items-center justify-between gap-4 backdrop-blur-md transition-opacity duration-200 ${activeSurface} ${
          isChromeVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Back to Library & TOC Drawer Button */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <button
            type="button"
            onClick={onBackToLibrary}
            aria-label="Retour à la bibliothèque"
            className="px-3 py-1.5 text-xs font-medium flex items-center gap-2 hover:opacity-75 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Bibliothèque</span>
          </button>

          <span aria-hidden="true" className="opacity-25">
            |
          </span>

          <button
            type="button"
            onClick={onToggleDrawer}
            aria-label="Ouvrir la table des matières et les signets"
            aria-expanded={isDrawerOpen}
            className="px-3 py-1.5 text-xs font-medium flex items-center gap-2 hover:opacity-75 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <List className="w-4 h-4" />
            <span>Sommaire & Signets</span>
            {bookmarks.length > 0 && (
              <span className="font-mono tabular-nums opacity-75">
                ({bookmarks.length})
              </span>
            )}
          </button>
        </div>

        {/* Center: Book Title & Author */}
        <div className="hidden xl:flex flex-col items-center text-center min-w-0 max-w-md">
          <h1 className="font-serif text-base font-semibold truncate w-full">
            {bookTitle}
          </h1>
          <p className="text-[11px] opacity-65 truncate w-full">{bookAuthor}</p>
        </div>

        {/* Right: Theme Switcher, View Mode, Auto-Crop Margins, Zoom & Bookmark */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Theme Switcher: Jour Blanc | Sépia Chaleureux | Nuit Noire */}
          <div
            role="group"
            aria-label="Thème de lecture"
            className="flex items-center p-0.5 border border-current/15 bg-black/5 dark:bg-white/5"
          >
            <button
              type="button"
              onClick={() => onSetTheme('light')}
              aria-label="Thème Jour Blanc"
              aria-pressed={theme === 'light'}
              className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                theme === 'light'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              Jour
            </button>
            <button
              type="button"
              onClick={() => onSetTheme('sepia')}
              aria-label="Thème Sépia Chaleureux"
              aria-pressed={theme === 'sepia'}
              className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                theme === 'sepia'
                  ? 'bg-[#E8DEC3] text-[#2C221E] shadow-xs font-semibold'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              Sépia
            </button>
            <button
              type="button"
              onClick={() => onSetTheme('dark')}
              aria-label="Thème Nuit Noire"
              aria-pressed={theme === 'dark'}
              className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                theme === 'dark'
                  ? 'bg-stone-800 text-stone-100 shadow-xs font-semibold'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              Nuit
            </button>
          </div>

          {/* Single vs Double Page Spread Toggle */}
          <div
            role="group"
            aria-label="Mode d'affichage des pages"
            className="hidden sm:flex items-center p-0.5 border border-current/15 bg-black/5 dark:bg-white/5"
          >
            <button
              type="button"
              onClick={() => onSetViewMode('single')}
              aria-label="Affichage 1 page"
              aria-pressed={viewMode === 'single'}
              className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'single'
                  ? 'bg-current/15 font-semibold'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>1 page</span>
            </button>
            <button
              type="button"
              onClick={() => onSetViewMode('double')}
              aria-label="Affichage 2 pages côte à côte"
              aria-pressed={viewMode === 'double'}
              className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'double'
                  ? 'bg-current/15 font-semibold'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>2 pages</span>
            </button>
          </div>

          {/* Auto-Crop Academic Whitespace Toggle (Kindle Oasis / Scribe) */}
          <button
            type="button"
            onClick={onToggleAutoCropMargins}
            aria-label="Recadrer automatiquement les marges blanches"
            aria-pressed={autoCropMargins}
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              autoCropMargins
                ? 'border-[#9A3412] bg-[#9A3412] text-white font-semibold'
                : 'border-current/20 hover:bg-current/10 opacity-85 hover:opacity-100'
            }`}
          >
            <Crop className="w-3.5 h-3.5" />
            <span>Marges</span>
          </button>

          {/* Zoom Controls */}
          <div className="hidden lg:flex items-center border border-current/15 bg-black/5 dark:bg-white/5">
            <button
              type="button"
              onClick={onZoomOut}
              aria-label="Réduire le zoom"
              className="p-1.5 hover:bg-current/10 transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onResetZoom}
              aria-label="Réinitialiser le zoom à 100%"
              className="px-2 py-1 text-xs font-mono tabular-nums hover:bg-current/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              aria-label="Augmenter le zoom"
              className="p-1.5 hover:bg-current/10 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Bookmark Toggle Button */}
          <button
            type="button"
            onClick={onToggleBookmarkCurrent}
            aria-label={
              isCurrentPageBookmarked
                ? 'Retirer le marque-page de cette page'
                : 'Ajouter un marque-page sur cette page'
            }
            aria-pressed={isCurrentPageBookmarked}
            className={`p-2 border transition-colors cursor-pointer ${
              isCurrentPageBookmarked
                ? 'border-[#9A3412] bg-[#9A3412] text-white'
                : 'border-current/20 hover:bg-current/10'
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${isCurrentPageBookmarked ? 'fill-current' : ''}`}
            />
          </button>
        </div>
      </header>

      {/* BOTTOM SCRUBBER BAR WITH THUMBNAIL SCRUBBING & READING TIME ETA */}
      <footer
        onMouseEnter={onChromeInteraction}
        onFocus={onChromeInteraction}
        className={`fixed bottom-0 inset-x-0 z-30 border-t px-4 sm:px-8 py-3 backdrop-blur-md transition-opacity duration-200 ${activeSurface} ${
          isChromeVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Floating Thumbnail Filmstrip Popover on Scrubber Hover/Drag */}
        {previewPage !== null && (
          <div
            data-testid="scrubber-thumbnail-popover"
            className={` pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3 p-3 border shadow-2xl flex flex-col items-center w-44 ${activeSurface}`}
          >
            <div className="w-28 aspect-[3/4] bg-white border border-current/15 overflow-hidden mb-2 flex items-center justify-center">
              {previewThumbUrl ? (
                <img
                  src={previewThumbUrl}
                  alt={`Aperçu miniature de la page ${previewPage}`}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-[11px] font-mono text-stone-400">
                  Page {previewPage}
                </span>
              )}
            </div>
            <p className="text-xs font-mono tabular-nums font-semibold">
              Page {previewPage} / {totalPages}
            </p>
            {getPreviewChapterTitle(previewPage) && (
              <p className="text-[11px] font-serif italic opacity-75 truncate w-full text-center mt-0.5">
                {getPreviewChapterTitle(previewPage)}
              </p>
            )}
          </div>
        )}

        <div className="max-w-5xl mx-auto flex flex-col gap-1.5">
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            {/* Page Indicator */}
            <div className="text-xs font-mono tabular-nums whitespace-nowrap shrink-0">
              <span>
                {visiblePages.length > 1
                  ? `Pages ${visiblePages[0]}–${visiblePages[1]} sur ${totalPages}`
                  : `Page ${currentPage} sur ${totalPages}`}
              </span>
            </div>

            {/* Interactive Scrubber Slider with Thumbnail Hover Detection */}
            <div
              ref={scrubberContainerRef}
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={() => setPreviewPage(null)}
              className="w-full flex-1 flex items-center gap-3 py-1"
            >
              <input
                type="range"
                min={1}
                max={Math.max(1, totalPages)}
                value={currentPage}
                onFocus={() => setPreviewPage(currentPage)}
                onBlur={() => setPreviewPage(null)}
                onChange={(e) => {
                  const target = Number(e.target.value);
                  setPreviewPage(target);
                  onGoToPage(target);
                }}
                aria-label="Curseur de progression dans le livre"
                className="w-full accent-[#9A3412] cursor-pointer h-1.5 bg-current/20"
              />
            </div>

            {/* Progress & Remaining Percentage */}
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums opacity-85 whitespace-nowrap shrink-0">
              <span>{progressPercentage}% lu</span>
              <span aria-hidden="true">·</span>
              <span>{remainingPercentage}% restant</span>
            </div>
          </div>

          {/* Kindle Oasis Dynamic Reading Speed & Remaining Time Row */}
          <div className="flex items-center justify-between text-[11px] opacity-70 font-mono tabular-nums">
            <span className="flex items-center gap-1.5 truncate">
              <Clock className="w-3 h-3 shrink-0" />
              <span data-testid="reader-eta-summary">{readingTimeSummary}</span>
            </span>
            <span className="hidden sm:inline">
              {autoCropMargins ? 'Recadrage marges : Actif' : 'Marges d’origine'}
            </span>
          </div>
        </div>
      </footer>

      {/* TABLE OF CONTENTS / BOOKMARKS / ANNOTATIONS DRAWER */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            onClick={onCloseDrawer}
            aria-hidden="true"
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          />

          {/* Drawer Panel */}
          <aside
            aria-label="Table des matières, signets et notes"
            className={`relative z-50 w-full max-w-md h-full border-r flex flex-col shadow-2xl ${activeSurface}`}
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-current/10 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-xl font-semibold">{bookTitle}</h2>
                <p className="text-xs opacity-65 mt-0.5">{bookAuthor}</p>
              </div>
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Fermer le tiroir de navigation"
                className="p-2 hover:bg-current/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Segmented Tabs */}
            <div
              role="tablist"
              aria-label="Sections du tiroir"
              className="grid grid-cols-3 border-b border-current/10 text-xs font-medium"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeDrawerTab === 'outline'}
                onClick={() => setActiveDrawerTab('outline')}
                className={`py-3 text-center border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeDrawerTab === 'outline'
                    ? 'border-[#9A3412] font-semibold'
                    : 'border-transparent opacity-65 hover:opacity-100'
                }`}
              >
                Chapitres ({outline.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeDrawerTab === 'bookmarks'}
                onClick={() => setActiveDrawerTab('bookmarks')}
                className={`py-3 text-center border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeDrawerTab === 'bookmarks'
                    ? 'border-[#9A3412] font-semibold'
                    : 'border-transparent opacity-65 hover:opacity-100'
                }`}
              >
                Signets ({bookmarks.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeDrawerTab === 'annotations'}
                onClick={() => setActiveDrawerTab('annotations')}
                className={`py-3 text-center border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeDrawerTab === 'annotations'
                    ? 'border-[#9A3412] font-semibold'
                    : 'border-transparent opacity-65 hover:opacity-100'
                }`}
              >
                Notes ({annotations.length})
              </button>
            </div>

            {/* Drawer Content Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* TAB 1: TABLE OF CONTENTS */}
              {activeDrawerTab === 'outline' && (
                <div>
                  {outline.length === 0 ? (
                    <div className="py-12 text-center opacity-70">
                      <BookOpen className="w-7 h-7 mx-auto mb-2 stroke-[1.5]" />
                      <p className="text-sm font-medium">
                        Aucune table des matières intégrée
                      </p>
                      <p className="text-xs mt-1">
                        Accès rapide par saut de page direct :
                      </p>
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(
                          (pageNum) => (
                            <button
                              key={pageNum}
                              type="button"
                              onClick={() => {
                                onGoToPage(pageNum);
                                onCloseDrawer();
                              }}
                              className={`py-2 text-xs font-mono tabular-nums border transition-colors cursor-pointer ${
                                pageNum === currentPage
                                  ? 'border-[#9A3412] bg-[#9A3412] text-white font-semibold'
                                  : 'border-current/15 hover:bg-current/10'
                              }`}
                            >
                              p. {pageNum}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <ul className="divide-y divide-current/10">
                      {outline.map((item, idx) => {
                        const isCurrent = item.pageNumber === currentPage;
                        return (
                          <li key={`${item.title}-${idx}`}>
                            <button
                              type="button"
                              onClick={() => {
                                onGoToPage(item.pageNumber);
                                onCloseDrawer();
                              }}
                              className={`w-full py-3.5 px-3 text-left flex items-baseline justify-between gap-4 transition-colors cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#9A3412]/15 font-semibold'
                                  : 'hover:bg-current/5'
                              }`}
                            >
                              <span className="font-serif text-base leading-snug">
                                {item.title}
                              </span>
                              <span className="text-xs font-mono tabular-nums opacity-65 shrink-0">
                                p. {item.pageNumber}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* TAB 2: BOOKMARKS */}
              {activeDrawerTab === 'bookmarks' && (
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-xs opacity-75">
                      Pages marquées dans cet ouvrage
                    </span>
                    <button
                      type="button"
                      onClick={onToggleBookmarkCurrent}
                      className="px-3 py-1.5 text-xs font-semibold border border-current/20 hover:bg-current/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isCurrentPageBookmarked
                        ? `Retirer p. ${currentPage}`
                        : `Marquer p. ${currentPage}`}
                    </button>
                  </div>

                  {bookmarks.length === 0 ? (
                    <div className="py-12 text-center opacity-70">
                      <Bookmark className="w-7 h-7 mx-auto mb-2 stroke-[1.5]" />
                      <p className="text-sm font-medium">Aucun signet enregistré</p>
                      <p className="text-xs mt-1">
                        Cliquez sur l’icône de signet en haut à droite ou appuyez sur la touche « B » pour conserver une page.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-current/10">
                      {bookmarks.map((pageNum) => (
                        <li
                          key={pageNum}
                          className="py-3 flex items-center justify-between gap-3"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onGoToPage(pageNum);
                              onCloseDrawer();
                            }}
                            className="flex-1 text-left flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            <Bookmark className="w-4 h-4 text-[#9A3412] fill-current shrink-0" />
                            <div>
                              <p className="font-serif text-base font-medium">
                                Page {pageNum}
                              </p>
                              <p className="text-xs opacity-65 font-mono tabular-nums">
                                {Math.round((pageNum / totalPages) * 100)}% de l’ouvrage
                              </p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleBookmarkPage(pageNum)}
                            aria-label={`Supprimer le signet de la page ${pageNum}`}
                            className="p-2 opacity-60 hover:opacity-100 hover:text-red-600 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* TAB 3: ANNOTATIONS & STUDY SHEET EXPORT / IMPORT */}
              {activeDrawerTab === 'annotations' && (
                <div>
                  <form onSubmit={handleNoteSubmit} className="mb-5">
                    <label
                      htmlFor="reader-annotation-input"
                      className="block text-xs font-medium mb-2 opacity-80"
                    >
                      Ajouter une note de lecture sur la page {currentPage}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="reader-annotation-input"
                        type="text"
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        placeholder="Ex. Référence architecturale importante…"
                        className="flex-1 px-3 py-2 text-xs border border-current/20 bg-transparent focus:outline-none focus:border-[#9A3412]"
                      />
                      <button
                        type="submit"
                        aria-label="Enregistrer la note"
                        className="px-3 py-2 text-xs font-semibold bg-[#9A3412] text-white hover:bg-[#7C2D12] transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
                      >
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                        <span>Noter</span>
                      </button>
                    </div>
                  </form>

                  {/* Export / Import Study Sheet Bar (Kindle Scribe Notebook Tools) */}
                  <div className="mb-5 p-3 border border-current/15 bg-current/5 flex flex-col gap-2.5">
                    <p className="text-[11px] uppercase tracking-wider opacity-70 font-medium">
                      Carnet d’étude — Export & Sauvegarde
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onExportMarkdown}
                        aria-label="Exporter les notes et signets en Markdown"
                        className="px-2.5 py-1.5 text-xs font-medium border border-current/20 hover:bg-current/10 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Markdown (.md)</span>
                      </button>
                      <button
                        type="button"
                        onClick={onExportJson}
                        aria-label="Exporter les notes et signets en JSON"
                        className="px-2.5 py-1.5 text-xs font-medium border border-current/20 hover:bg-current/10 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        <span>Export JSON</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => jsonInputRef.current?.click()}
                        aria-label="Importer des notes depuis un fichier JSON"
                        className="px-2.5 py-1.5 text-xs font-medium border border-current/20 hover:bg-current/10 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Importer JSON</span>
                      </button>
                      <input
                        ref={jsonInputRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => void handleImportFileChange(e)}
                        className="sr-only"
                        aria-label="Sélectionner un fichier JSON de notes"
                      />
                    </div>
                    {importFeedback && (
                      <p
                        role="status"
                        className="text-xs text-[#9A3412] dark:text-amber-400 font-medium"
                      >
                        {importFeedback}
                      </p>
                    )}
                  </div>

                  {annotations.length === 0 ? (
                    <div className="py-8 text-center opacity-70">
                      <p className="text-sm font-medium">
                        Aucune annotation pour cet ouvrage
                      </p>
                      <p className="text-xs mt-1">
                        Vos réflexions et notes de bas de page sont sauvegardées dans IndexedDB et exportables en fiche de lecture Markdown.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {annotations.map((item) => (
                        <li
                          key={item.id}
                          className="p-3.5 border border-current/15 bg-current/5 flex items-start justify-between gap-3"
                        >
                          <div
                            onClick={() => {
                              onGoToPage(item.pageNumber);
                              onCloseDrawer();
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onGoToPage(item.pageNumber);
                                onCloseDrawer();
                              }
                            }}
                            className="flex-1 cursor-pointer"
                          >
                            <p className="text-xs font-mono tabular-nums text-[#9A3412] dark:text-amber-400 font-semibold">
                              Page {item.pageNumber}
                            </p>
                            <p className="text-sm mt-1 leading-relaxed">
                              {item.note}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveAnnotation(item.id)}
                            aria-label={`Supprimer la note de la page ${item.pageNumber}`}
                            className="p-1.5 opacity-60 hover:opacity-100 hover:text-red-600 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Drawer Footer: Auto-Crop, View Mode & Reset Zoom */}
            <div className="p-4 border-t border-current/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onSetViewMode(viewMode === 'single' ? 'double' : 'single')
                  }
                  className="px-2.5 py-1.5 border border-current/20 hover:bg-current/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {viewMode === 'single' ? '1 page' : '2 pages'}
                </button>
                <button
                  type="button"
                  onClick={onToggleAutoCropMargins}
                  className={`px-2.5 py-1.5 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    autoCropMargins
                      ? 'border-[#9A3412] bg-[#9A3412] text-white'
                      : 'border-current/20 hover:bg-current/10'
                  }`}
                >
                  {autoCropMargins ? 'Marges rognées' : 'Rogner marges'}
                </button>
              </div>
              <button
                type="button"
                onClick={onResetZoom}
                className="px-2.5 py-1.5 flex items-center gap-1.5 opacity-75 hover:opacity-100 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>100%</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
