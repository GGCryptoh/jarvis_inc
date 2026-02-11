import type { Position } from '../types';

// ---- Desk zone boundaries ----
const DESK_ZONE = { xMin: 10, xMax: 55, yMin: 15, yMax: 85 };
const COLS = 3;
const COL_SPACING = (DESK_ZONE.xMax - DESK_ZONE.xMin) / (COLS - 1); // ~22.5
const ROW_SPACING = 30; // vertical gap between rows

/** CEO sits in the corner office — fixed position, never part of the desk grid. */
export const CEO_OFFICE_POSITION: Position = { x: 82, y: 72 };

/**
 * How many desks the office should have (always one spare).
 */
export function getDeskCountWithSpare(agentCount: number): number {
  return agentCount + 1;
}

/**
 * Generate desk positions in rows of 3.
 * Rows grow downward from the top of the desk zone so existing desks never shift.
 * Alternating rows get a slight x-stagger and y-jitter for organic feel.
 */
export function generateDeskPositions(count: number): Position[] {
  const positions: Position[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;

    const xStagger = row % 2 === 1 ? 2 : 0;
    const yJitter = col % 2 === 1 ? 1.5 : 0;

    const x = DESK_ZONE.xMin + col * COL_SPACING + xStagger;
    const y = DESK_ZONE.yMin + row * ROW_SPACING + yJitter;

    positions.push({ x, y });
  }
  return positions;
}

/**
 * Generate meeting positions in an oval around the conference table center (35%, 67%).
 */
export function generateMeetingPositions(count: number): Position[] {
  const cx = 35, cy = 67;
  const rx = 14, ry = 10;
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  });
}

/**
 * Generate break positions in a circle around the water cooler (76%, 25%).
 */
export function generateBreakPositions(count: number): Position[] {
  const cx = 76, cy = 25;
  const r = 10;
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });
}

/**
 * Generate all-hands positions in circles / multi-ring around center (38%, 45%).
 * First ring holds up to 8, overflow goes to an outer ring.
 */
export function generateAllHandsPositions(count: number): Position[] {
  const cx = 38, cy = 45;
  const innerMax = 8;
  const innerR = 12;
  const outerR = 22;

  const positions: Position[] = [];
  const innerCount = Math.min(count, innerMax);
  const outerCount = Math.max(0, count - innerMax);

  for (let i = 0; i < innerCount; i++) {
    const angle = (2 * Math.PI * i) / innerCount - Math.PI / 2;
    positions.push({
      x: cx + innerR * Math.cos(angle),
      y: cy + innerR * Math.sin(angle),
    });
  }

  for (let i = 0; i < outerCount; i++) {
    const angle = (2 * Math.PI * i) / outerCount - Math.PI / 2;
    positions.push({
      x: cx + outerR * Math.cos(angle),
      y: cy + outerR * Math.sin(angle),
    });
  }

  return positions;
}
