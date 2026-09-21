import { Component, Input, computed, signal } from '@angular/core';

/**
 * Renders a self-hosted Material Symbols icon (public/icons/material/*.svg,
 * copied from @material-symbols/svg-400 so they stay in the offline service
 * worker cache — no Google Fonts CDN dependency). Uses a CSS mask rather
 * than <img>, so the icon's color follows the surrounding text color
 * (currentColor) regardless of the source SVG's own fill.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: '',
  styles: [
    `
      :host {
        display: inline-block;
        width: 1.25em;
        height: 1.25em;
        vertical-align: middle;
        background-color: currentColor;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: contain;
        mask-size: contain;
        -webkit-mask-position: center;
        mask-position: center;
      }
    `,
  ],
  host: {
    '[attr.role]': '"img"',
    '[attr.aria-label]': 'label || null',
    '[attr.aria-hidden]': '!label',
    '[style.-webkit-mask-image]': 'maskUrl()',
    '[style.mask-image]': 'maskUrl()',
  },
})
export class IconComponent {
  private readonly _name = signal('');
  @Input({ required: true }) set name(value: string) {
    this._name.set(value);
  }

  /** Accessible name. Omit for purely decorative icons (paired with visible text). */
  @Input() label?: string;

  readonly maskUrl = computed(() => `url(icons/material/${this._name()}.svg)`);
}
