/**
 * SVG backend — renders the drawing IR for on-screen preview.
 *
 * The viewBox is in millimetres, so ops are emitted with their coordinates
 * unchanged. Text is given an explicit `textLength` measured with the same AFM
 * tables the PDF uses, which forces the browser's substitute face to occupy the
 * exact width the exported PDF will, so line ends and centring match.
 */
import { Fragment, type ReactNode } from 'react';
import { assetUrl } from '../assets';
import { CSS_FONT_STACK } from './fonts';
import type { Fill, Op, Stroke } from './ops';
import { baselineY, leftX, widthOf } from './text';

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

function strokeProps(stroke?: Stroke): Record<string, string | number> {
  if (!stroke || stroke.width <= 0) return { stroke: 'none' };
  const props: Record<string, string | number> = {
    stroke: stroke.color,
    strokeWidth: stroke.width,
    // Hairlines land between device pixels otherwise, and rulings look uneven.
    strokeLinecap: stroke.cap ?? 'butt',
    strokeLinejoin: stroke.join ?? 'miter',
  };
  if (stroke.dash?.length) props.strokeDasharray = stroke.dash.join(' ');
  if (stroke.opacity !== undefined && stroke.opacity < 1) props.strokeOpacity = stroke.opacity;
  return props;
}

function fillProps(fill?: Fill): Record<string, string | number> {
  if (!fill) return { fill: 'none' };
  const props: Record<string, string | number> = { fill: fill.color };
  if (fill.opacity !== undefined && fill.opacity < 1) props.fillOpacity = fill.opacity;
  return props;
}

let clipSeq = 0;

export function renderOps(ops: Op[], keyPrefix = 'op'): ReactNode[] {
  return ops.map((op, i) => renderOp(op, `${keyPrefix}-${i}`));
}

function renderOp(op: Op, key: string): ReactNode {
  switch (op.kind) {
    case 'line':
      return (
        <line
          key={key}
          x1={op.x1}
          y1={op.y1}
          x2={op.x2}
          y2={op.y2}
          {...strokeProps(op.stroke)}
        />
      );

    case 'rect':
      return (
        <rect
          key={key}
          x={op.x}
          y={op.y}
          width={Math.max(0, op.w)}
          height={Math.max(0, op.h)}
          rx={op.radius || undefined}
          {...fillProps(op.fill)}
          {...strokeProps(op.stroke)}
        />
      );

    case 'ellipse':
      return (
        <ellipse
          key={key}
          cx={op.cx}
          cy={op.cy}
          rx={Math.max(0, op.rx)}
          ry={Math.max(0, op.ry)}
          {...fillProps(op.fill)}
          {...strokeProps(op.stroke)}
        />
      );

    case 'polyline': {
      const points = [];
      for (let i = 0; i < op.points.length; i += 2) {
        points.push(`${fmt(op.points[i])},${fmt(op.points[i + 1])}`);
      }
      const Tag = op.closed ? 'polygon' : 'polyline';
      return (
        <Tag key={key} points={points.join(' ')} {...fillProps(op.fill)} {...strokeProps(op.stroke)} />
      );
    }

    case 'path':
      return (
        <path
          key={key}
          d={op.d}
          fillRule={op.fillRule}
          {...fillProps(op.fill)}
          {...strokeProps(op.stroke)}
        />
      );

    case 'text': {
      if (!op.text) return null;
      const x = leftX(op);
      const y = baselineY(op);
      const width = widthOf(op);
      const rotate = op.rotate ?? 0;
      return (
        <text
          key={key}
          x={x}
          y={y}
          fontFamily={CSS_FONT_STACK[op.font.family]}
          fontSize={op.size}
          fontWeight={op.font.bold ? 700 : 400}
          fontStyle={op.font.italic ? 'italic' : 'normal'}
          fill={op.color}
          fillOpacity={op.opacity ?? 1}
          textLength={width > 0 ? width : undefined}
          lengthAdjust={op.letterSpacing ? 'spacing' : 'spacingAndGlyphs'}
          transform={rotate ? `rotate(${fmt(rotate)} ${fmt(op.x)} ${fmt(op.y)})` : undefined}
          style={{ whiteSpace: 'pre' }}
        >
          {op.text}
        </text>
      );
    }

    case 'image':
      return (
        <image
          key={key}
          href={assetUrl(op.assetId)}
          x={op.x}
          y={op.y}
          width={Math.max(0, op.w)}
          height={Math.max(0, op.h)}
          opacity={op.opacity ?? 1}
          preserveAspectRatio="none"
          transform={
            op.rotate ? `rotate(${fmt(op.rotate)} ${fmt(op.x + op.w / 2)} ${fmt(op.y + op.h / 2)})` : undefined
          }
        />
      );

    case 'group': {
      const children = renderOps(op.ops, key);
      if (!op.clip) {
        return (
          <g
            key={key}
            transform={op.matrix ? `matrix(${op.matrix.map(fmt).join(' ')})` : undefined}
            opacity={op.opacity ?? 1}
          >
            {children}
          </g>
        );
      }
      const clipId = `clip-${clipSeq++}`;
      return (
        <Fragment key={key}>
          <defs>
            <clipPath id={clipId}>
              <rect x={op.clip.x} y={op.clip.y} width={op.clip.w} height={op.clip.h} />
            </clipPath>
          </defs>
          <g
            transform={op.matrix ? `matrix(${op.matrix.map(fmt).join(' ')})` : undefined}
            opacity={op.opacity ?? 1}
            clipPath={`url(#${clipId})`}
          >
            {children}
          </g>
        </Fragment>
      );
    }
  }
}
