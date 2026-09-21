import { Component, Input } from '@angular/core';

/** Brief, optional, non-blocking avatar celebration/encouragement (FR-045). */
@Component({
  selector: 'app-avatar-reaction',
  standalone: true,
  imports: [],
  template: `<span class="avatar-reaction" [class.happy]="mood === 'happy'" [class.encourage]="mood === 'encourage'">
    {{ mood === 'happy' ? '🎉' : '💪' }}
  </span>`,
  styles: [
    `.avatar-reaction { font-size: 2rem; display: inline-block; animation: pop 0.4s ease-out; }
     @keyframes pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }`,
  ],
})
export class AvatarReactionComponent {
  @Input() mood: 'happy' | 'encourage' = 'happy';
}
