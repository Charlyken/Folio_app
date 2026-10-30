/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, BookWithProgress } from '../entities/Book';
import { ReadingSession } from '../entities/ReadingSession';

export interface IBookRepository {
  /**
   * Saves both the book metadata, the initial reading session, and the binary PDF blob.
   */
  saveBook(book: Book, pdfBlob: Blob, initialSession?: ReadingSession): Promise<void>;

  /**
   * Retrieves the heavy binary PDF Blob for a given book ID.
   */
  getBookBlob(bookId: string): Promise<Blob | null>;

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
   * Updates the reading session (currentPage, zoomLevel, theme, viewMode, bookmarks, annotations)
   * and updates the book's lastReadAt timestamp.
   */
  updateReadingProgress(session: ReadingSession): Promise<void>;

  /**
   * Deletes the book metadata, reading session, and binary blob from persistent storage.
   */
  deleteBook(bookId: string): Promise<void>;
}
