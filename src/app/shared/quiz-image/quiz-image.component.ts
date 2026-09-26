import { Component, Input, computed, signal } from '@angular/core';
import { QuizItem } from '../models/domain.model';

/** Folder (under `public/`, served at the app root) that a bare image filename resolves into. */
export const QUIZ_IMAGE_ASSET_DIR = 'assets/images/';

/**
 * Turns a quiz/passage image reference into an `<img src>`:
 * - `https://…`, `http://…`, `data:image/…`, `blob:…` are used as-is
 *   (`//host/…` gets `https:`), so a picture can come straight from the internet;
 * - anything else is a path relative to the app root, e.g.
 *   `assets/images/lop2/cam.png` or `/assets/images/cam.png`;
 * - a bare filename (`cam.png`) is looked up in `assets/images/`, which is
 *   the friendliest form to type into an Excel sheet.
 */
export function resolveQuizImageUrl(ref: string | undefined | null): string | undefined {
  const value = ref?.trim();
  if (!value) return undefined;
  if (/^(https?:|data:image\/|blob:)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  const path = value.replace(/^(\.\/|\/)+/, '');
  return path.includes('/') ? path : `${QUIZ_IMAGE_ASSET_DIR}${path}`;
}

/** Sets/clears `imageRef` on a QuizItem's media while keeping any other media field (e.g. audioRef); returns undefined when nothing is left. */
export function withImageRef(media: QuizItem['media'], imageUrl: string | undefined): QuizItem['media'] {
  const next = { ...media, imageRef: imageUrl?.trim() || undefined };
  return next.imageRef || next.audioRef ? next : undefined;
}

/**
 * Illustration shown with a quiz prompt or passage text. Renders nothing for
 * an empty reference, and a small notice instead of a broken-image icon when
 * the picture can't be loaded (e.g. an internet image while offline).
 */
@Component({
  selector: 'app-quiz-image',
  standalone: true,
  template: `
    @if (resolvedSrc(); as url) {
      @if (!failed()) {
        <img [src]="url" [alt]="alt" loading="lazy" (error)="failed.set(true)" />
      } @else {
        <p class="image-error">Không tải được hình ảnh.</p>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        text-align: center;
      }
      :host:empty {
        display: none;
      }
      img {
        display: inline-block;
        max-width: 100%;
        max-height: var(--quiz-image-max-height, 40vh);
        object-fit: contain;
        border-radius: 12px;
        margin: 0.5rem 0;
      }
      .image-error {
        font-size: 0.85rem;
        opacity: 0.7;
        font-style: italic;
      }
    `,
  ],
})
export class QuizImageComponent {
  private readonly source = signal<string | undefined>(undefined);
  readonly resolvedSrc = computed(() => resolveQuizImageUrl(this.source()));
  readonly failed = signal(false);

  @Input() set src(value: string | undefined | null) {
    this.source.set(value ?? undefined);
    this.failed.set(false);
  }

  @Input() alt = 'Hình minh họa';
}
