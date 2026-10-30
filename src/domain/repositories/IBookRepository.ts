/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, BookWithProgress } from '../entities/Book';
import { ReadingSession } from '../entities/ReadingSession';

export interface IBookRepository {
  /**
   * Saves the book metadata, the initial reading session, and persists the binary PDF
   * split into 2 MB ArrayBuffer chunks inside IndexedDB (`books_chunks`).
   */
  saveBook(book: Book, pdfBlob: Blob, initialSession?: ReadingSession): Promise<void>;

  /**
   * Finds an existing book in the library matching the given SHA-256 content hash.
   */
  findBookByContentHash(contentHash: string): Promise<Book | null>;

  /**
   * Reassembles the binary PDF Blob from IndexedDB chunks (or legacy blob store) for a given book ID.
   */
  getBookBlob(bookId: string): Promise<Blob | null>;

  /**
   * Reads a specific byte range [begin, end) directly from the chunked IndexedDB store
   * to support streaming PDF range transport without loading the whole file at once.
   */
  getBookByteRange(bookId: string, begin: number, end: number): Promise<Uint8Array>;

  /**
   * Retrieves a single book metadata record by ID.
   */
  getBookMetadata(bookId: string): Promise<Book | null>;

  /**
   * Fast query returning all books metadata combined with their latest reading session progress.
   */
  getAllBooksMetadata(): Promise<BookWithProgress[]>;

  /**
   * Retrieves the persisted reading session for a book, or creates a default one if missing.
   */
  getReadingSession(bookId: string): Promise<ReadingSession>;

  /**
   * Updates the reading session (currentPage, zoomLevel, theme, viewMode, autoCropMargins,
   * averageSecondsPerPage, bookmarks, annotations) and updates the book's lastReadAt timestamp.
   */
  updateReadingProgress(session: ReadingSession): Promise<void>;

  /**
   * Deletes the book metadata, reading session, and all binary chunks from persistent storage.
   */
  deleteBook(bookId: string): Promise<void>;
}
