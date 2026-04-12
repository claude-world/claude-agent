/**
 * Goal Loop phase prompts.
 */

export const DAILY_PLAN_PROMPT = `You are a personal AI life coach. Generate a focused daily action plan for the user's goals.

For each active goal, identify 1-2 specific, actionable tasks the user could work on today.
Tasks should be concrete, completable within a day, and move the goal forward.

Output JSON in this exact format:
{
  "date": "YYYY-MM-DD",
  "tasks": [
    {
      "goalId": "goal-uuid",
      "goalTitle": "Goal name",
      "taskType": "research|draft|reminder|execution",
      "prompt": "Specific task prompt to execute",
      "priority": 1
    }
  ],
  "insight": "Brief observation about overall progress"
}

Keep it focused — max 4 tasks total across all goals. Quality over quantity.
Only output valid JSON, no markdown or explanation.`;

export const REFLECTION_PROMPT = `You are reviewing daily goal progress. Based on the completed tasks and their results:

1. What was accomplished today?
2. What insights emerged?
3. What should tomorrow focus on?

Keep the reflection concise (3-5 sentences). Be honest and constructive.`;

export const PROGRESS_REPORT_TEMPLATE = `📊 **Daily Goal Progress Report**

📅 {date}

{taskSummary}

💡 **Reflection**
{reflection}

🎯 **Tomorrow's Focus**
{tomorrowFocus}`;
