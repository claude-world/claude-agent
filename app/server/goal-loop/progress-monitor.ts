/**
 * Progress monitor — tracks milestone completion based on session/execution history.
 */

import store from "../db.ts";
import type { GoalEntry } from "../db.ts";

export interface ProgressUpdate {
  goalId: string;
  goalTitle: string;
  milestonesCompleted: number;
  milestonesTotal: number;
  percentComplete: number;
  recentActivity: boolean;
}

/**
 * Scan recent sessions to detect if any goals were mentioned/worked on.
 * Uses simple keyword matching (no LLM call needed).
 */
export function detectGoalActivity(goal: GoalEntry, hoursBack = 24): boolean {
  try {
    const sessions = store.listAllSessions();
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const recentSessions = sessions.filter(s => s.updated_at >= cutoff);

    const keywords = [
      goal.title.toLowerCase(),
      ...goal.tags.map(t => t.toLowerCase()),
      ...goal.milestones.map(m => m.title.toLowerCase()),
    ].filter(k => k.length > 3); // skip very short keywords

    for (const session of recentSessions.slice(0, 10)) {
      const messages = store.getMessages(session.id, 20, 0);
      const text = messages.map(m => (m.content || "").toLowerCase()).join(" ");
      if (keywords.some(k => text.includes(k))) return true;
    }
  } catch {}
  return false;
}

/**
 * Get progress summary for all active goals.
 */
export function getProgressSummary(): ProgressUpdate[] {
  const goals = store.listGoals();
  return goals.map(g => {
    const done = g.milestones.filter(m => m.done).length;
    const total = g.milestones.length;
    return {
      goalId: g.id,
      goalTitle: g.title,
      milestonesCompleted: done,
      milestonesTotal: total,
      percentComplete: total > 0 ? Math.round((done / total) * 100) : 0,
      recentActivity: detectGoalActivity(g),
    };
  });
}
