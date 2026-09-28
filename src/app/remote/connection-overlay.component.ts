import { Component, computed, effect, signal } from '@angular/core';
import { RemoteStore } from './remote-store';
import { StartupService } from './startup.service';
import { IconComponent } from '../shared/icon/icon.component';

/** Lost connections shorter than this don't show the overlay (a brief network hiccup). */
const GRACE_MS = 3000;

/**
 * Covers the app while the connection to the server is lost (specs/003 §1:
 * the app needs internet). Firebase keeps what was just saved and sends it when
 * the connection is back; the overlay then goes away by itself.
 */
@Component({
  selector: 'app-connection-overlay',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (visible()) {
      <div class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="connection-title">
        <div class="panel">
          <h2 id="connection-title"><app-icon name="warning" />Mất kết nối tới máy chủ</h2>
          <p>Đang chờ kết nối lại… Kiểm tra mạng (Wi-Fi hoặc 4G).</p>
          <p class="hint">Những gì vừa làm được giữ lại và sẽ tự gửi khi có mạng.</p>
          <span class="spinner" aria-hidden="true"></span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .overlay {
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
        gap: 0.6rem;
        align-items: flex-start;
      }
      h2 {
        margin: 0;
        display: flex;
        gap: 0.4rem;
        align-items: center;
        color: #8a1c14;
        font-size: 1.15rem;
      }
      p {
        margin: 0;
      }
      .hint {
        color: #666;
        font-size: 0.9rem;
      }
      .spinner {
        width: 1.75rem;
        height: 1.75rem;
        border: 3px solid #cfd8dc;
        border-top-color: #1976d2;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class ConnectionOverlayComponent {
  private readonly lostLongEnough = signal(false);
  /** Only after the app has started (the login screen shows start-up problems itself). */
  readonly visible = computed(() => this.startup.state() === 'done' && this.lostLongEnough());

  constructor(
    remote: RemoteStore,
    private readonly startup: StartupService,
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const connected = remote.connected();
      clearTimeout(timer);
      if (connected) this.lostLongEnough.set(false);
      else timer = setTimeout(() => this.lostLongEnough.set(true), GRACE_MS);
    });
  }
}
