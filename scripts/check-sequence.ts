/**
 * Asserts that repeating sections step dated generators forward.
 * Run: npm run check:sequence
 */
import { compileNotebook } from '../src/lib/compile/notebook';
import { createNotebook } from '../src/lib/defaults';
import { newId } from '../src/lib/ids';
import { defaultParams, getGenerator, paramsForStep } from '../src/lib/parametric';
import type { ContentItem, Notebook } from '../src/lib/types/notebook';
import { weeksInYear } from '../src/lib/parametric/dates';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

/** Builds "repeat × [generator, dot grid × dots]" and returns the page labels. */
function labelsFor(
  generatorId: string,
  params: Record<string, unknown>,
  repeat: number,
  advanceDates: boolean,
  dots = 0
): string[] {
  const nb: Notebook = createNotebook({ name: 'seq', presetIds: ['dots-5'] });

  const group: ContentItem = {
    kind: 'group',
    id: newId('item'),
    label: 'Section',
    repeat,
    advanceDates,
    items: [
      {
        kind: 'parametric',
        id: newId('item'),
        generatorId,
        params,
        baseTemplateId: null,
        label: '',
      },
      ...(dots > 0
        ? [
            {
              kind: 'template' as const,
              id: newId('item'),
              templateId: nb.templates[0].id,
              count: dots,
              label: '',
            },
          ]
        : []),
    ],
  };

  nb.content = [group];
  return compileNotebook(nb, { assets: {}, math: {} }).pages.map((p) => p.label);
}

const gen = (id: string) => {
  const g = getGenerator(id);
  if (!g) throw new Error(`missing generator ${id}`);
  return g;
};

console.log('\n== monthly calendar advances one month per repeat ==');
const monthParams = { ...defaultParams(gen('calendar-month')), year: 2026, scope: 'single', startMonth: 1 };
check(
  '12 repeats from January 2026',
  labelsFor('calendar-month', monthParams, 12, true),
  [
    'January 2026', 'February 2026', 'March 2026', 'April 2026',
    'May 2026', 'June 2026', 'July 2026', 'August 2026',
    'September 2026', 'October 2026', 'November 2026', 'December 2026',
  ]
);

console.log('\n== a configurable starting month rolls into the next year ==');
check(
  '3 repeats from November 2026',
  labelsFor('calendar-month', { ...monthParams, startMonth: 11 }, 3, true),
  ['November 2026', 'December 2026', 'January 2027']
);

console.log('\n== the section keeps its other entries in order ==');
check(
  '3 × [month, dots × 2]',
  labelsFor('calendar-month', monthParams, 3, true, 2),
  [
    'January 2026', 'Dot grid 5 mm', 'Dot grid 5 mm',
    'February 2026', 'Dot grid 5 mm', 'Dot grid 5 mm',
    'March 2026', 'Dot grid 5 mm', 'Dot grid 5 mm',
  ]
);

console.log('\n== a whole-year calendar narrows to one page per repeat ==');
check(
  'scope=year, 3 repeats',
  labelsFor('calendar-month', { ...defaultParams(gen('calendar-month')), year: 2026, scope: 'year' }, 3, true),
  ['January 2026', 'February 2026', 'March 2026']
);

console.log('\n== the toggle off repeats the same month ==');
check(
  '3 repeats, advanceDates off',
  labelsFor('calendar-month', monthParams, 3, false),
  ['January 2026', 'January 2026', 'January 2026']
);

console.log('\n== other dated generators ==');
// 2026 is a 53-week ISO year, so the rollover point is derived rather than
// hard-coded — that is exactly the edge the sequencing has to get right.
const lastWeek = weeksInYear(2026);
check(
  'weekly planner rolls into the next ISO year',
  labelsFor(
    'calendar-week',
    { ...defaultParams(gen('calendar-week')), year: 2026, startWeek: lastWeek - 1, weekCount: 1 },
    3,
    true
  ),
  [`Week ${lastWeek - 1}, 2026`, `Week ${lastWeek}, 2026`, 'Week 1, 2027']
);
check(
  'daily planner steps days',
  labelsFor(
    'daily-planner',
    { ...defaultParams(gen('daily-planner')), startDate: '2026-02-27', dayCount: 1, skipWeekends: false },
    3,
    true
  ),
  ['27 February 2026', '28 February 2026', '1 March 2026']
);
check(
  'daily planner skips weekends when asked',
  labelsFor(
    'daily-planner',
    { ...defaultParams(gen('daily-planner')), startDate: '2026-01-02', dayCount: 1, skipWeekends: true },
    3,
    true
  ),
  ['2 January 2026', '5 January 2026', '6 January 2026']
);
check(
  'habit tracker steps months',
  labelsFor(
    'habit-tracker',
    { ...defaultParams(gen('habit-tracker')), year: 2026, scope: 'single', month: 11 },
    3,
    true
  ),
  ['Habits — November 2026', 'Habits — December 2026', 'Habits — January 2027']
);
check(
  'year overview steps years',
  labelsFor('calendar-year', { ...defaultParams(gen('calendar-year')), year: 2026 }, 3, true),
  ['2026 overview', '2027 overview', '2028 overview']
);

console.log('\n== editor preview labels ==');
const monthly = gen('calendar-month');
check(
  'labelFor walks forward',
  [0, 1, 11].map((step) => monthly.sequence!.labelFor(monthParams, step)),
  ['Jan 2026', 'Feb 2026', 'Dec 2026']
);
check(
  'paramsForStep is a no-op without sequencing',
  paramsForStep(monthly, monthParams, null),
  monthParams
);

console.log('\n== identical repeats still share artwork ==');
{
  const nb = createNotebook({ name: 'dedupe', presetIds: ['dots-5'] });
  nb.content = [
    {
      kind: 'group',
      id: newId('item'),
      label: 'Section',
      repeat: 10,
      advanceDates: false,
      items: [
        {
          kind: 'parametric',
          id: newId('item'),
          generatorId: 'cornell-notes',
          params: { ...defaultParams(gen('cornell-notes')), pageCount: 1 },
          baseTemplateId: null,
          label: '',
        },
      ],
    },
  ];
  const compiled = compileNotebook(nb, { assets: {}, math: {} });
  check('10 identical repeats -> 1 distinct page', new Set(compiled.pages.map((p) => p.contentKey)).size, 1);
}

console.log(failures === 0 ? '\nAll sequence checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
