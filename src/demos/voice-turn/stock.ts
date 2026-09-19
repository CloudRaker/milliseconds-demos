import { SCRIPT, SLOT_LABELS, type Intent } from './data';
import { slotQuestion } from './engine';
// A response can land between any two words. Include prefixes and every remaining suffix.
export const STOCK_SEGMENTS = [...new Set(SCRIPT.flatMap(utterance => utterance.words.flatMap((_, from) => utterance.words.slice(from).map((_, offset) => utterance.words.slice(from, from + offset + 1).map(word => word.text).join(' ')))))];
export function slotLabels(intent: Intent, text: string): Record<string, string> | null {
  const question = slotQuestion(intent, text);
  if (!question?.candidates.length) return null;
  return Object.fromEntries([['none', SLOT_LABELS[question.kind].none], ...question.candidates.map(candidate => [candidate, SLOT_LABELS[question.kind].hit])]);
}
