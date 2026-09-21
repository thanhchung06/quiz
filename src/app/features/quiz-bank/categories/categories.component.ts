import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { Category, CategorySubject } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

interface CategoryRow {
  category: Category;
  itemCount: number;
}

/** Category management screen (FR-022): create/rename/describe/archive/restore/merge. */
@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
})
export class CategoriesComponent {
  readonly rows = signal<CategoryRow[]>([]);
  readonly newName = signal('');
  readonly newSubject = signal<CategorySubject>('math');
  readonly errorMessage = signal('');
  readonly mergeSource = signal<string | undefined>(undefined);

  constructor(private readonly categories: CategoryRepository) {
    void this.load();
  }

  private async load(): Promise<void> {
    const all = await this.categories.list();
    const rows = await Promise.all(
      all.map(async (category) => ({ category, itemCount: await this.categories.itemCount(category.id) })),
    );
    this.rows.set(rows);
  }

  async create(): Promise<void> {
    if (!this.newName().trim()) return;
    try {
      await this.categories.createCategory(this.newName().trim(), this.newSubject());
      this.newName.set('');
      this.errorMessage.set('');
      await this.load();
    } catch (e) {
      this.errorMessage.set((e as Error).message);
    }
  }

  async rename(category: Category, name: string): Promise<void> {
    await this.categories.rename(category.id, name);
    await this.load();
  }

  async archive(category: Category): Promise<void> {
    await this.categories.archive(category.id);
    await this.load();
  }

  async restore(category: Category): Promise<void> {
    await this.categories.restore(category.id);
    await this.load();
  }

  startMerge(category: Category): void {
    this.mergeSource.set(category.id);
  }

  async mergeInto(target: Category): Promise<void> {
    const source = this.mergeSource();
    if (!source || source === target.id) return;
    await this.categories.merge(target.id, source);
    this.mergeSource.set(undefined);
    await this.load();
  }
}
