import { Injectable } from '@angular/core';
import { Assignment, Exercise } from '../../shared/models/domain.model';
import { increment, RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';

/**
 * Assignments (specs/003 §2): assignments/{childId}/{id}, one row each. The
 * parent adds or removes; the child's device removes it when done and raises
 * the try count (an atomic +1).
 */
@Injectable({ providedIn: 'root' })
export class AssignmentRepository {
  constructor(private readonly remote: RemoteStore) {}

  async getById(childId: string, id: string): Promise<Assignment | undefined> {
    return this.read(await this.remote.get<StoredNode>(`assignments/${childId}/${id}`));
  }

  async listForChild(childId: string): Promise<Assignment[]> {
    const rows = await this.remote.list<StoredNode>(`assignments/${childId}`);
    return rows
      .map((row) => this.read(row.value))
      .filter((a): a is Assignment => !!a)
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }

  async listAll(): Promise<Assignment[]> {
    const children = await this.remote.list<Record<string, StoredNode>>('assignments');
    return children
      .flatMap((child) => Object.values(child.value).map((node) => this.read(node)))
      .filter((a): a is Assignment => !!a)
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }

  /** Parent: gives `exercise` (as it is now) to a child. */
  async assign(childId: string, exercise: Exercise, options: { availableFrom?: string; deadline?: string } = {}): Promise<Assignment> {
    const assignment: Assignment = {
      id: crypto.randomUUID(),
      childId,
      exerciseId: exercise.id,
      exerciseSnapshot: { ...exercise },
      assignedAt: new Date().toISOString(),
      availableFrom: options.availableFrom,
      deadline: options.deadline,
      tries: 0,
    };
    const { tries, ...rest } = assignment;
    await this.remote.update({ [`assignments/${childId}/${assignment.id}`]: encode(rest, 'updatedAt', { tries }) });
    return assignment;
  }

  /** Parent (take back). The child's removal is part of the finish (ResultRepository.recordFinish). */
  async remove(assignment: Pick<Assignment, 'id' | 'childId'>): Promise<void> {
    await this.remote.update({ [`assignments/${assignment.childId}/${assignment.id}`]: null });
  }

  /** Child, when starting a try: an atomic +1, so two devices never count one try. */
  async addTry(assignment: Pick<Assignment, 'id' | 'childId'>): Promise<void> {
    await this.remote.update({ [`assignments/${assignment.childId}/${assignment.id}/tries`]: increment(1) });
  }

  private read(node: StoredNode | undefined): Assignment | undefined {
    const assignment = decode<Assignment & { updatedAt?: string }>(node);
    if (!assignment) return undefined;
    const { updatedAt: _u, ...rest } = assignment;
    return { ...rest, tries: typeof node?.['tries'] === 'number' ? (node['tries'] as number) : 0 };
  }
}
