import { Injectable } from '@angular/core';
import { db } from '../db';
import { enqueue } from '../outbox';
import { Assignment, Exercise } from '../../shared/models/domain.model';
import { JsonRecord } from '../../sync/protocol';

/**
 * Assignments (plan §3.2): on Google one row per child holding that child's
 * list; changed only by small operations — the parent adds or removes, the
 * child removes (done) or raises the try count — never by rewriting the list.
 */
@Injectable({ providedIn: 'root' })
export class AssignmentRepository {
  async getById(id: string): Promise<Assignment | undefined> {
    return db.assignments.get(id);
  }

  async listForChild(childId: string): Promise<Assignment[]> {
    const all = await db.assignments.where('childId').equals(childId).toArray();
    return all.sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
  }

  async listAll(): Promise<Assignment[]> {
    return (await db.assignments.toArray()).sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
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
    await db.assignments.add(assignment);
    await enqueue({ op: 'ADD_ASSIGNMENT', childId, assignment: assignment as unknown as JsonRecord });
    return assignment;
  }

  /** Parent (take back) or child (no tries left / passed). Removing twice is harmless. */
  async remove(assignment: Pick<Assignment, 'id' | 'childId'>): Promise<void> {
    await db.assignments.delete(assignment.id);
    await enqueue({ op: 'REMOVE_ASSIGNMENT', childId: assignment.childId, assignmentId: assignment.id });
  }

  /** Child, when starting a try: Google keeps the larger count, so a repeat is harmless. */
  async setTries(assignment: Pick<Assignment, 'id' | 'childId'>, tries: number): Promise<void> {
    await db.assignments.update(assignment.id, { tries });
    await enqueue({ op: 'SET_TRY', childId: assignment.childId, assignmentId: assignment.id, tries });
  }
}
