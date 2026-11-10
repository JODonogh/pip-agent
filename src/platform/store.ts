import type * as vscode from 'vscode';
import type { Concept, TurnStat } from '../shared/types';
import { safeReviewCard, type RetrievalQuestion } from '../learning/day-summary';

const CONCEPTS_KEY = 'pip.concepts.v1';
const HISTORY_KEY = 'pip.history.v1';
const STATS_KEY = 'pip.stats.v1';
const REVIEW_KEY = 'pip.review.v1';

export interface ReviewCard {
  /** Local date string (yyyy-mm-dd) the summary was made. */
  date: string;
  text: string;
  questions?: RetrievalQuestion[];
  conceptIds?: string[];
  schemaVersion?: 2;
}

/**
 * Context store over VS Code globalState (survives restarts, lives in the
 * editor's own storage — never in the user's repo). Note: the session timer
 * is deliberately NEVER written here; it lives and dies with the panel.
 */
export class PipStore {
  constructor(private readonly state: vscode.Memento) {}

  concepts(): Concept[] {
    return this.state.get<Concept[]>(CONCEPTS_KEY, []);
  }

  async saveConcepts(concepts: readonly Concept[]): Promise<void> {
    await this.state.update(CONCEPTS_KEY, [...concepts]);
  }

  async upsertConcept(concept: Concept): Promise<void> {
    const all = this.concepts().filter((c) => c.id !== concept.id);
    all.push(concept);
    await this.saveConcepts(all);
  }

  history(): string[] {
    return this.state.get<string[]>(HISTORY_KEY, []);
  }

  async addHistory(question: string): Promise<void> {
    const next = [question, ...this.history()].slice(0, 100);
    await this.state.update(HISTORY_KEY, next);
  }

  review(): ReviewCard | null {
    return safeReviewCard(this.state.get<ReviewCard | null>(REVIEW_KEY, null), this.concepts());
  }

  async saveReview(review: ReviewCard): Promise<void> {
    await this.state.update(REVIEW_KEY, review);
  }

  stats(): TurnStat[] {
    return this.state.get<TurnStat[]>(STATS_KEY, []);
  }

  async addStat(stat: TurnStat): Promise<void> {
    await this.state.update(STATS_KEY, [stat, ...this.stats()].slice(0, 50));
  }
}
