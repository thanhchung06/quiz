import { Component, Input } from '@angular/core';

/**
 * Read-aloud for language prompts (FR-045, research.md #10): prefers a
 * parent-recorded audio clip when present; falls back to the Web Speech
 * API with a Vietnamese voice when supported; silently does nothing
 * otherwise, so its absence never blocks answering the question.
 */
@Component({
  selector: 'app-read-aloud',
  standalone: true,
  imports: [],
  template: `<button type="button" class="read-aloud" (click)="play()" [hidden]="!canPlay()">🔊 Nghe</button>`,
})
export class ReadAloudComponent {
  @Input() audioRef?: string;
  @Input() text = '';

  canPlay(): boolean {
    return !!this.audioRef || (typeof window !== 'undefined' && 'speechSynthesis' in window);
  }

  play(): void {
    if (this.audioRef) {
      new Audio(this.audioRef).play().catch(() => this.speak());
      return;
    }
    this.speak();
  }

  private speak(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !this.text) return;
    const utterance = new SpeechSynthesisUtterance(this.text);
    utterance.lang = 'vi-VN';
    window.speechSynthesis.speak(utterance);
  }
}
