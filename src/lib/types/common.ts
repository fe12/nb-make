import { z } from 'zod';
import { PAGE_SIZE_NAMES } from '../units';

export const zOrientation = z.enum(['portrait', 'landscape']);

export const zPageSize = z.object({
  name: z.enum(PAGE_SIZE_NAMES),
  orientation: zOrientation,
  width: z.number().positive().max(2000),
  height: z.number().positive().max(2000),
});

export const zMargins = z.object({
  top: z.number().min(0).max(200),
  right: z.number().min(0).max(200),
  bottom: z.number().min(0).max(200),
  left: z.number().min(0).max(200),
});

/**
 * A colour is either a literal or a `theme:<role>` reference into the
 * notebook's palette. References survive all the way to the drawing ops and are
 * resolved in one pass there, so a palette change repaints every page.
 */
export const zColor = z
  .string()
  .regex(
    /^(theme:(primary|secondary|secondaryAlt|accent)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+)$/,
    'Expected a CSS colour or a theme colour'
  );

export const zFont = z.object({
  family: z.enum(['helvetica', 'times', 'courier']).default('helvetica'),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
});

export type FontValue = z.infer<typeof zFont>;

export const zAlign = z.enum(['left', 'center', 'right']);
export const zVAlign = z.enum(['top', 'middle', 'bottom']);

/**
 * Rect expressed as fractions (0..1) of the page's content box.
 *
 * Storing blocks relatively rather than in absolute millimetres is what makes a
 * template authored at A4 render sensibly at A6: the layout keeps its
 * proportions and only the type scale has to be decided separately.
 */
export const zRelRect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export type RelRect = z.infer<typeof zRelRect>;

export const fullRect: RelRect = { x: 0, y: 0, w: 1, h: 1 };

export const zStrokeStyle = z.object({
  color: zColor.default('#c8d4e0'),
  width: z.number().min(0.01).max(10).default(0.2),
  dash: z.array(z.number().min(0)).max(6).optional(),
  opacity: z.number().min(0).max(1).default(1),
});

export type StrokeStyle = z.infer<typeof zStrokeStyle>;

export const DEFAULT_STROKE: StrokeStyle = {
  color: '#c8d4e0',
  width: 0.2,
  opacity: 1,
};
