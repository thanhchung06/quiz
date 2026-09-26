import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';

/**
 * Optional picture for one answer option, used under each choice row in the
 * quiz item form and the passage editor. Collapsed to a small "add picture"
 * link until the parent wants one, so text-only choices stay compact.
 */
@Component({
  selector: 'app-choice-image-field',
  standalone: true,
  imports: [QuizImageComponent],
  template: `
    @if (open() || value) {
      <div class="field">
        <input
          [value]="value ?? ''"
          (change)="valueChange.emit($any($event.target).value.trim())"
          placeholder="Hình cho lựa chọn: https://… hoặc tên tệp, ví dụ: cam.png"
          aria-label="Hình cho lựa chọn"
        />
        <button type="button" class="clear" (click)="clear()" aria-label="Bỏ hình">✕</button>
      </div>
      <app-quiz-image class="thumb" [src]="value" />
    } @else {
      <button type="button" class="add" (click)="open.set(true)">🖼 Thêm hình</button>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .field {
        display: flex;
        gap: 0.5rem;
      }
      .field input {
        flex: 1;
        min-width: 0;
        font-size: 0.85rem;
      }
      .add,
      .clear {
        border: none;
        background: none;
        color: #2f6fed;
        font-size: 0.85rem;
        padding: 0.1rem 0;
        cursor: pointer;
      }
      .clear {
        color: #b3261e;
      }
      .thumb {
        text-align: left;
        --quiz-image-max-height: 6rem;
      }
    `,
  ],
})
export class ChoiceImageFieldComponent {
  @Input() value?: string;
  @Output() readonly valueChange = new EventEmitter<string>();
  readonly open = signal(false);

  clear(): void {
    this.open.set(false);
    this.valueChange.emit('');
  }
}
