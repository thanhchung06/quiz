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
        errors.push('Cần ít nhất 2 lựa chọn.');
      }
      if (choices?.some((c) => !c.text.trim() && !c.imageRef?.trim())) {
        errors.push('Mỗi lựa chọn cần có nội dung hoặc hình.');
      }
    }

    if (rule.kind === 'choice') {
      if (rule.correctChoiceIds.length < 1) {
        errors.push('Chưa đánh dấu đáp án đúng.');
      }
      const choiceIds = new Set((choices ?? []).map((c) => c.id));
      for (const id of rule.correctChoiceIds) {
        if (!choiceIds.has(id)) {
          errors.push('Đáp án đúng trỏ tới một lựa chọn không còn tồn tại.');
        }
      }
      if (type === 'single-choice' && rule.correctChoiceIds.length > 1) {
        errors.push('Câu chọn một chỉ được có 1 đáp án đúng.');
      }
    }

    if (rule.kind === 'text' && rule.acceptedAnswer.trim().length === 0) {
      errors.push('Chưa nhập đáp án đúng.');
    }

    if (rule.kind === 'number' && rule.acceptedValue === undefined && (rule.min === undefined || rule.max === undefined)) {
      errors.push('Chưa nhập đáp án số.');
    }

    if (rule.kind === 'pairs' && rule.pairs.length < 1) {
      errors.push('Câu nối cặp cần ít nhất một cặp.');
    }

    return { valid: errors.length === 0, errors };
  }
}
