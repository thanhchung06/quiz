import { Component, Input, Output, EventEmitter } from '@angular/core';

export interface Theme {
  key: string;
  label: string;
  starsRequired: number;
}

export const THEMES: Theme[] = [
  { key: 'default', label: 'Mặc định', starsRequired: 0 },
  { key: 'ocean', label: 'Đại dương', starsRequired: 10 },
  { key: 'space', label: 'Vũ trụ', starsRequired: 25 },
  { key: 'forest', label: 'Rừng xanh', starsRequired: 50 },
];

/** Stars unlock optional cosmetic themes without changing scores (FR-045). */
@Component({
  selector: 'app-unlockable-themes',
  standalone: true,
  imports: [],
  templateUrl: './unlockable-themes.component.html',
  styleUrl: './unlockable-themes.component.scss',
})
export class UnlockableThemesComponent {
  @Input() totalStars = 0;
  @Input() selectedTheme = 'default';
  @Output() readonly themeSelected = new EventEmitter<string>();

  readonly themes = THEMES;

  isUnlocked(theme: Theme): boolean {
    return this.totalStars >= theme.starsRequired;
  }
}
