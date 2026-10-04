import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** How long the popup stays before closing itself. */
const AUTO_CLOSE_MS = 2500;

/**
 * A short "it worked" popup (e.g. after saving a question): a centered
 * message with an OK button, closing itself after a moment.
 */
@Component({
  selector: 'app-success-popup',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="popup" role="alertdialog" aria-modal="true" [attr.aria-label]="message" (click)="$event.stopPropagation()">
        <app-icon name="check_circle" class="icon" />
        <p>{{ message }}</p>
        <button type="button" (click)="closed.emit()">OK</button>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.25);
      }
      .popup {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        min-width: 16rem;
        max-width: calc(100vw - 2rem);
        padding: 1.25rem 1.5rem;
        border-radius: 0.75rem;
        background: white;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        text-align: center;
      }
      .icon {
        width: 2.5rem;
        height: 2.5rem;
        color: #1e7a34;
      }
      p {
        margin: 0;
        font-size: 1.05rem;
      }
    `,
  ],
})
export class SuccessPopupComponent implements OnInit, OnDestroy {
  @Input() message = 'Đã lưu thành công!';
  @Output() readonly closed = new EventEmitter<void>();
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.timer = setTimeout(() => this.closed.emit(), AUTO_CLOSE_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
