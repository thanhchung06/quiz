import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { SessionService } from '../../core/auth/session.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Tổng quan', icon: 'dashboard' },
  { path: '/quiz-bank', label: 'Ngân hàng câu hỏi', icon: 'quiz' },
  { path: '/categories', label: 'Danh mục', icon: 'category' },
  { path: '/quiz-bank/import', label: 'Nhập gói câu hỏi', icon: 'cloud_upload' },
  { path: '/exercise-library', label: 'Bài tập', icon: 'book' },
  { path: '/schedule', label: 'Lịch giao bài', icon: 'calendar_month' },
  { path: '/rotation', label: 'Vòng luyện tập', icon: 'shuffle' },
  { path: '/redeem-points', label: 'Đổi điểm thưởng', icon: 'star' },
  { path: '/sync', label: 'Đồng bộ', icon: 'sync' },
  { path: '/backup', label: 'Sao lưu', icon: 'backup' },
  { path: '/settings', label: 'Cài đặt', icon: 'settings' },
];

/**
 * Responsive app shell for every parent-facing screen: a docked sidebar on
 * wide viewports, collapsing to a hamburger-triggered overlay drawer on
 * narrow ones. Fixes the earlier gap where quiz-bank/exercise-builder/
 * schedule/sync had no way back except the browser's own back button.
 */
@Component({
  selector: 'app-parent-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './parent-shell.component.html',
  styleUrl: './parent-shell.component.scss',
})
export class ParentShellComponent {
  readonly navItems = NAV_ITEMS;
  readonly drawerOpen = signal(false);

  constructor(
    private readonly session: SessionService,
    private readonly router: Router,
  ) {}

  toggleDrawer(): void {
    this.drawerOpen.update((v) => !v);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  async logout(): Promise<void> {
    this.session.logout();
    await this.router.navigateByUrl('/profiles');
  }
}
