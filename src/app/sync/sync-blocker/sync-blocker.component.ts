import { Component, computed, signal } from '@angular/core';
import { SyncWriterService } from '../sync-writer.service';
import { StartupSyncService } from '../startup-sync.service';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * Covers the whole app while a write couldn't reach Google (plan §1: no
 * offline while sync is on): the error and "Thử lại", nothing else, until a
 * retry gets every queued write through. The data is already saved on the
 * device; only the upload is waiting. While the app-start sync hasn't
 * finished, its own error screen (with "Thử lại") on the login page covers this.
 */
@Component({
  selector: 'app-sync-blocker',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (error(); as message) {
      <div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="sync-blocker-title">
        <div class="panel">
          <h2 id="sync-blocker-title"><app-icon name="warning" />Chưa gửi được lên Google</h2>
          <p>{{ message }}</p>
          <p class="hint">Dữ liệu đã được lưu trên máy này. Còn {{ pending() }} thay đổi chờ gửi.</p>
          <button type="button" [disabled]="retrying()" (click)="retry()">
            <app-icon name="refresh" />{{ retrying() ? 'Đang gửi…' : 'Thử lại' }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .blocker {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      }
      .panel {
        background: #fff;
        color: #222;
        border-radius: 0.75rem;
        padding: 1.25rem;
        max-width: 26rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      h2 {
        margin: 0;
        display: flex;
        gap: 0.4rem;
        align-items: center;
        color: #8a1c14;
        font-size: 1.15rem;
      }
      .hint {
        color: #666;
        font-size: 0.9rem;
        margin: 0;
      }
      button {
        align-self: flex-start;
        display: flex;
        gap: 0.4rem;
        align-items: center;
        padding: 0.5rem 1rem;
        font-size: 1rem;
      }
    `,
  ],
})
export class SyncBlockerComponent {
  readonly error = computed(() => (this.startup.state() === 'done' ? this.writer.error() : undefined));
  readonly pending: SyncWriterService['pending'];
  readonly retrying = signal(false);

  constructor(
    private readonly writer: SyncWriterService,
    private readonly startup: StartupSyncService,
  ) {
    this.pending = writer.pending;
  }

  async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.writer.retry();
    } catch {
      // still failing: the message stays
    } finally {
      this.retrying.set(false);
    }
  }
}
