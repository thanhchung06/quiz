import { Component, Input } from '@angular/core';

/** Each completed exercise moves the child one step along a visual map toward a reward (spec: Treasure path). */
@Component({
  selector: 'app-treasure-path',
  standalone: true,
  imports: [],
  templateUrl: './treasure-path.component.html',
  styleUrl: './treasure-path.component.scss',
})
export class TreasurePathComponent {
  @Input() totalSteps = 10;
  @Input() currentStep = 0;

  get steps(): number[] {
    return Array.from({ length: this.totalSteps }, (_, i) => i);
  }
}
