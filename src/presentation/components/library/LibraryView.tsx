/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BookOpen, CheckCircle2, Plus, RotateCcw, Search, X } from 'lucide-react';
import { LibraryFilter, UseLibraryResult } from '../../../application/useLibrary';
import { BookCard } from './BookCard';
import { PdfDropzone } from './PdfDropzone';
import { PWAInstallControl } from './PWAInstallControl';

export interface LibraryViewProps {
  readonly library: UseLibraryResult;
  readonly onOpenBook: (bookId: string) => void;
  readonly isDarkUi: boolean;
  readonly onToggleDarkUi: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  library,
  onOpenBook,
  isDarkUi,
  onToggleDarkUi,
}) => {
  const [isDropzoneOpen, setIsDropzoneOpen] = useState<boolean>(false);

  const {
    libraryState,
    uploadState,
    deduplicationNotice,
    activeFilter,
    searchQuery,
    filteredBooks,
    setActiveFilter,
    setSearchQuery,
    uploadPdfFile,
    deleteBook,
    restoreSampleBooks,
    dismissUploadError,
    dismissDeduplicationNotice,
  } = library;

  const allBooksCount =
    libraryState.status === 'success' ? libraryState.data.length : 0;

  // Featured / Most Recently Read Book for Lead Salience
  const featuredBook =
    libraryState.status === 'success' && libraryState.data.length > 0
      ? libraryState.data[0]
      : null;

  const filterLinks: { readonly id: LibraryFilter; readonly label: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'in_progress', label: 'En cours' },
    { id: 'completed', label: 'Terminés' },
    { id: 'bookmarked', label: 'Signets' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] dark:bg-stone-950 text-[#1C1917] dark:text-stone-100 transition-colors">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 lg:px-12 py-4 border-b border-stone-200/90 dark:border-stone-800 bg-[#FBF9F5]/95 dark:bg-stone-950/95 sticky top-0 z-20 backdrop-blur-sm">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#collection"
          onClick={(e) => {
            e.preventDefault();
            setActiveFilter('all');
          }}
          className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 whitespace-nowrap shrink-0"
        >
          Folio
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Filtres de la bibliothèque"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600 dark:text-stone-400"
        >
          {filterLinks.map((link) => {
            const isActive = activeFilter === link.id;
            return (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveFilter(link.id);
                }}
                className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
                  isActive
                    ? 'text-[#9A3412] dark:text-amber-400 underline underline-offset-8 decoration-2'
                    : 'hover:text-stone-900 dark:hover:text-stone-100'
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsDropzoneOpen((prev) => !prev)}
            className="px-4 py-2 text-xs font-semibold tracking-wide text-white bg-[#1C1917] hover:bg-[#9A3412] dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Importer un PDF</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-8 sm:py-12">
        {/* SHA-256 Deduplication Notice Banner */}
        {deduplicationNotice && (
          <div
            role="status"
            className="mb-8 p-4 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 flex items-start justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#14532D] dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  Déduplication SHA-256 — Ouvrage déjà présent dans vos archives
                </p>
                <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5">
                  {deduplicationNotice.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onOpenBook(deduplicationNotice.book.id);
                  dismissDeduplicationNotice();
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#9A3412] hover:bg-[#7C2D12] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Ouvrir le livre
              </button>
              <button
                type="button"
                onClick={dismissDeduplicationNotice}
                aria-label="Fermer la notification de déduplication"
                className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Upload Dropzone Drawer */}
        <PdfDropzone
          isOpen={isDropzoneOpen}
          onClose={() => setIsDropzoneOpen(false)}
          uploadState={uploadState}
          onUploadFile={uploadPdfFile}
          onDismissError={dismissUploadError}
        />

        {/* Editorial Marquee & Featured Reading Resume Banner */}
        {featuredBook && activeFilter === 'all' && searchQuery.trim() === '' && (
          <section
            aria-label="Lecture en vedette"
            className="mb-12 pb-10 border-b border-stone-200 dark:border-stone-800 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch"
          >
            <div className="lg:col-span-8 flex flex-col justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400 mb-3">
                  LECTURE EN COURS · STOCKAGE PAR BLOCS INDEXEDDB & PWA HORS-LIGNE
                </p>
                <h1 className="font-serif text-3xl sm:text-5xl font-semibold text-stone-900 dark:text-stone-100 leading-[1.12]">
                  {featuredBook.title}
                </h1>
                <p className="text-base sm:text-lg text-stone-600 dark:text-stone-400 mt-3 max-w-2xl leading-relaxed">
                  Par <span className="text-stone-900 dark:text-stone-200 font-medium">{featuredBook.author}</span>. Reprenez exactement votre lecture là où vous l’aviez interrompue avec préchargement instantané des pages, recadrage intelligent des marges et thèmes optiques calibrés.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-stone-200/80 dark:border-stone-800/80 flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center flex-wrap gap-3 text-xs text-stone-600 dark:text-stone-400 font-mono tabular-nums">
                  <span>
                    Page actuelle : {featuredBook.currentPage} sur {featuredBook.totalPages}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Progression : {featuredBook.progressPercentage}%</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {featuredBook.bookmarksCount} signet{featuredBook.bookmarksCount > 1 ? 's' : ''}
                  </span>
                  {featuredBook.chunkCount !== undefined && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {featuredBook.chunkCount} bloc{featuredBook.chunkCount > 1 ? 's' : ''} binaire{featuredBook.chunkCount > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenBook(featuredBook.id)}
                    className="px-6 py-3 text-xs font-semibold tracking-wide text-white bg-[#9A3412] hover:bg-[#7C2D12] transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Lire « {featuredBook.title} »</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 flex items-center justify-center lg:justify-end">
              <div
                onClick={() => onOpenBook(featuredBook.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenBook(featuredBook.id);
                  }
                }}
                aria-label={`Ouvrir la couverture de ${featuredBook.title}`}
                className="w-48 sm:w-56 aspect-[3/4] border border-stone-300 dark:border-stone-700 bg-[#EBE6DF] dark:bg-stone-800 shadow-sm overflow-hidden cursor-pointer group relative"
              >
                {featuredBook.coverDataUrl && (
                  <img
                    src={featuredBook.coverDataUrl}
                    alt={`Couverture de ${featuredBook.title}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/20 via-black/5 to-transparent"
                />
              </div>
            </div>
          </section>
        )}

        {/* Workspace Toolbar: Search, Mobile Filter Tabs, PWA Install, and Theme Toggle */}
        <section
          aria-label="Outils de filtrage et recherche"
          className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-stone-900 dark:text-stone-100">
              Catalogue des ouvrages
            </h2>
            <span className="text-xs text-stone-500 dark:text-stone-400 font-mono tabular-nums">
              ({filteredBooks.length} sur {allBooksCount})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Mobile segmented filter buttons */}
            <div className="flex md:hidden items-center gap-1 p-1 bg-stone-200/70 dark:bg-stone-900">
              {filterLinks.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => setActiveFilter(link.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeFilter === link.id
                      ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100'
                      : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {link.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un titre, auteur…"
                aria-label="Rechercher un livre par titre ou auteur"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:border-[#9A3412] dark:focus:border-amber-500 transition-colors"
              />
            </div>

            {/* In-App PWA Install & Offline Status */}
            <PWAInstallControl />

            {/* Quiet UI surface mode button */}
            <button
              type="button"
              onClick={onToggleDarkUi}
              aria-label={
                isDarkUi
                  ? 'Activer l’éclairage papier clair de la bibliothèque'
                  : 'Activer l’éclairage nocturne de la bibliothèque'
              }
              className="px-3 py-2 text-xs font-medium border border-stone-300 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:border-stone-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDarkUi ? 'Atmosphère Papier' : 'Atmosphère Nocturne'}
            </button>
          </div>
        </section>

        {/* Books Grid States */}
        {libraryState.status === 'loading' && (
          <div className="py-20 text-center border border-stone-200 dark:border-stone-800 bg-white/50 dark:bg-stone-900/40">
            <p className="font-serif text-xl text-stone-700 dark:text-stone-300">
              {libraryState.message ?? 'Chargement de la bibliothèque…'}
            </p>
          </div>
        )}

        {libraryState.status === 'error' && (
          <div
            role="alert"
            className="p-8 border border-red-800/40 bg-red-950/5 dark:bg-red-950/20 text-center"
          >
            <h3 className="font-serif text-xl font-semibold text-red-900 dark:text-red-200">
              {libraryState.error.title}
            </h3>
            <p className="text-sm text-red-800 dark:text-red-300 mt-2">
              {libraryState.error.message}
            </p>
          </div>
        )}

        {libraryState.status === 'success' && filteredBooks.length === 0 && (
          <div className="py-16 px-6 text-center border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
            <BookOpen className="w-8 h-8 text-stone-400 mx-auto mb-3 stroke-[1.5]" />
            <h3 className="font-serif text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Aucun ouvrage ne correspond à votre sélection
            </h3>
            <p className="text-sm text-stone-600 dark:text-stone-400 mt-2 max-w-md mx-auto">
              Importez un fichier PDF depuis votre ordinateur ou restaurez les éditions patrimoniales de démonstration.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setIsDropzoneOpen(true)}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-[#1C1917] hover:bg-[#9A3412] dark:bg-stone-100 dark:text-stone-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Importer un fichier PDF
              </button>
              {allBooksCount === 0 && (
                <button
                  type="button"
                  onClick={() => void restoreSampleBooks()}
                  className="px-4 py-2.5 text-xs font-medium border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:text-stone-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurer les ouvrages d’exemple</span>
                </button>
              )}
              {(activeFilter !== 'all' || searchQuery.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('all');
                    setSearchQuery('');
                  }}
                  className="px-4 py-2.5 text-xs font-medium border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:text-stone-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          </div>
        )}

        {libraryState.status === 'success' && filteredBooks.length > 0 && (
          <div
            data-testid="library-books-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onOpenBook={onOpenBook}
                onDeleteBook={deleteBook}
              />
            ))}
          </div>
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-stone-200/80 dark:border-stone-800 py-6 px-6 lg:px-12 text-xs text-stone-500 dark:text-stone-400 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span>
          Folio — Liseuse numérique PDF · Stockage par blocs IndexedDB, Déduplication SHA-256 & Mode PWA Hors-Ligne
        </span>
        <span className="font-mono tabular-nums">
          Raccourcis : Flèches ←/→ · Espace · Touche B (Signet) · Touche C (Recadrage marges)
        </span>
      </footer>
    </div>
  );
};
