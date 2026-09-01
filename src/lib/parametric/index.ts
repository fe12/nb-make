import { calendarMonth, calendarWeek, calendarYear } from './generators/calendar';
import { dailyPlanner, habitTracker, mealPlanner } from './generators/planner';
import { cornellNotes, indexPage, storyboard, titlePage } from './generators/notes';
import {
  budgetLedger,
  kanbanBoard,
  projectGantt,
  readingLog,
  workoutLog,
} from './generators/tracking';
import type { Generator } from './registry';

export * from './registry';
export * from './dates';

export const GENERATORS: Generator[] = [
  titlePage,
  calendarYear,
  calendarMonth,
  calendarWeek,
  dailyPlanner,
  mealPlanner,
  kanbanBoard,
  projectGantt,
  cornellNotes,
  indexPage,
  storyboard,
  habitTracker,
  budgetLedger,
  workoutLog,
  readingLog,
];

const BY_ID = new Map(GENERATORS.map((g) => [g.id, g]));

export const getGenerator = (id: string): Generator | undefined => BY_ID.get(id);

export const GENERATOR_CATEGORIES = [
  'Calendar',
  'Planning',
  'Notes',
  'Tracking',
  'Creative',
] as const;

export function generatorsByCategory(): Array<{ category: string; generators: Generator[] }> {
  return GENERATOR_CATEGORIES.map((category) => ({
    category,
    generators: GENERATORS.filter((g) => g.category === category),
  })).filter((group) => group.generators.length > 0);
}
