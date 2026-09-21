import { Injectable } from '@angular/core';
import { AnswerRule, Choice, QuizItemType } from '../../../shared/models/domain.model';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a quiz item's answer configuration before save (FR-017):
 * choice-based types require at least 2 choices and at least 1 correct
 * answer id, resolved by choice id rather than position.
 */
@Injectable({ providedIn: 'root' })
export class QuizValidationService {
  validate(type: QuizItemType, choices: Choice[] | undefined, rule: AnswerRule): ValidationResult {
    const errors: string[] = [];

    if (type === 'single-choice' || type === 'multiple-choice' || type === 'true-false' || type === 'match-pairs') {
      if (!choices || choices.length < 2) {
        errors.push('Choice-based questions require at least 2 choices.');
      }
    }

    if (rule.kind === 'choice') {
      if (rule.correctChoiceIds.length < 1) {
        errors.push('At least one correct answer id is required.');
      }
      const choiceIds = new Set((choices ?? []).map((c) => c.id));
      for (const id of rule.correctChoiceIds) {
        if (!choiceIds.has(id)) {
          errors.push(`correctChoiceIds references unknown choice id "${id}".`);
        }
      }
      if (type === 'single-choice' && rule.correctChoiceIds.length !== 1) {
        errors.push('single-choice requires exactly 1 correct answer id.');
      }
    }

    if (rule.kind === 'text' && rule.acceptedAnswer.trim().length === 0) {
      errors.push('acceptedAnswer must not be empty for short-text questions.');
    }

    if (rule.kind === 'number' && rule.acceptedValue === undefined && (rule.min === undefined || rule.max === undefined)) {
      errors.push('number questions require either acceptedValue or a min/max range.');
    }

    if (rule.kind === 'pairs' && rule.pairs.length < 1) {
      errors.push('match-pairs questions require at least one pair.');
    }

    return { valid: errors.length === 0, errors };
  }
}
