/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLibrary } from './application/useLibrary';
import { PdfJsAdapter } from './infrastructure/pdf/PdfJsAdapter';
import { IndexedDbBookRepository } from './infrastructure/persistence/IndexedDbBookRepository';
import { LibraryView } from './presentation/components/library/LibraryView';
import { ReaderView } from './presentation/components/reader/ReaderView';

const UI_THEME_STORAGE_KEY = 'folio_library_dark_mode_v1';

export default function App() {
  // Dependency Injection at Composition Root (Clean Architecture)
  const bookRepository = useMemo(() => new IndexedDbBookRepository(), []);
  const pdfEngine = useMemo(() => new PdfJsAdapter(), []);

  const library = useLibrary(bookRepository, pdfEngine);

  const [activeBookId, setActiveBookId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('book');
  });

  const [isDarkUi, setIsDarkUi] = useState<boolean>(() => {
    return window.localStorage.getItem(UI_THEME_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkUi) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, String(isDarkUi));
  }, [isDarkUi]);

  // Support ?autostart=1 query param to jump straight to reading the first book
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('autostart') === '1' &&
      !activeBookId &&
      library.libraryState.status === 'success' &&
      library.libraryState.data.length > 0
    ) {
      setActiveBookId(library.libraryState.data[0].id);
    }
  }, [activeBookId, library.libraryState]);

  const handleOpenBook = useCallback((bookId: string) => {
    setActiveBookId(bookId);
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setActiveBookId(null);
    void library.refreshLibrary();
  }, [library]);

  if (activeBookId) {
    return (
      <ReaderView
        bookId={activeBookId}
        repository={bookRepository}
        pdfEngine={pdfEngine}
        onBackToLibrary={handleBackToLibrary}
      />
    );
  }

  return (
    <LibraryView
      library={library}
      onOpenBook={handleOpenBook}
      isDarkUi={isDarkUi}
      onToggleDarkUi={() => setIsDarkUi((prev) => !prev)}
    />
  );
}
