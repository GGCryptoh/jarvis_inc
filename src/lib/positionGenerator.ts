import type { Position } from '../types';

// ---- Room Tiers ----
export type RoomTier = 1 | 2 | 3 | 4;

/** Determine room tier from agent count (not counting CEO).
 *  Tier 1: CEO alone (0 agents) — startup garage
 *  Tier 2: 1-3 agents — first office
 *  Tier 3: 4-6 agents — growing team
 *  Tier 4: 7+ agents — full floor
 */
export function getRoomTier(agentCount: number): RoomTier {
  if (agentCount <= 0) return 1;
  if (agentCount <= 3) return 2;
  if (agentCount <= 6) return 3;
  return 4;
}

/** Floor image path per tier. */
export const FLOOR_IMAGES: Record<RoomTier, string> = {
  1: '/floors/startup.png',
  2: '/floors/level2.jpg',
  3: '/floors/level3.jpg',
  4: '/floors/level4.jpg',
};

/**
 * Preset desk positions per tier — these match the desk locations in the
 * pre-made pixel art floor images. Agents sit behind/below the desk center.
 * Coordinates are % of the image container (0-100).
 */
export const TIER_DESK_PRESETS: Record<RoomTier, Position[]> = {
  // Tier 1 — startup.png: 1 desk only (CEO uses the main desk)
  1: [
    { x: 45, y: 70 },
  ],
  // Tier 2 — level2.jpg: CEO at main desk, agent desks at bottom corners
  2: [
    { x: 13.2, y: 91.4 },
    { x: 82.2, y: 91.8 },
    { x: 45, y: 78 },
  ],
  // Tier 3 — level3.jpg: agents 1-2 same as T2 bottom corners, 3-4 upper area
  3: [
    { x: 13.2, y: 91.4 },
    { x: 82.2, y: 91.8 },
    { x: 43.7, y: 27.0 },
    { x: 26.5, y: 46.9 },
    { x: 42, y: 82 },
    { x: 70, y: 75 },
  ],
  // Tier 4 — level4.jpg: large office
  4: [
    { x: 34.8, y: 87.3 },
    { x: 65.4, y: 88.2 },
    { x: 62.6, y: 70.3 },
    { x: 39.4, y: 45.2 },
    { x: 53.2, y: 24.7 },
    { x: 25, y: 55 },
    { x: 20, y: 72 },
    { x: 42, y: 75 },
    { x: 65, y: 34 },
  ],
};

/** CEO desk position per tier — matches the main CEO desk in each floor image. */
export const TIER_CEO_POSITION: Record<RoomTier, Position> = {
  1: { x: 52, y: 55.3 },
  2: { x: 43, y: 47 },
  3: { x: 43, y: 32 },
  4: { x: 79.3, y: 51.8 },
};

/** Meeting zone per tier — where agents/CEO walk to for meetings. */
export const TIER_MEETING_ZONE: Record<RoomTier, Position> = {
  1: { x: 36, y: 37 },
  2: { x: 36, y: 37 },
  3: { x: 36, y: 37 },  // TODO: get coords from floor
  4: { x: 49.8, y: 73.8 },
};

/** Break zone per tier — where agents/CEO walk to for breaks. */
export const TIER_BREAK_ZONE: Record<RoomTier, Position> = {
  1: { x: 73, y: 32 },
  2: { x: 73, y: 32 },
  3: { x: 73, y: 32 },  // TODO: get coords from floor
  4: { x: 73, y: 32 },  // TODO: get coords from floor
};

/** @deprecated Use TIER_CEO_POSITION instead. Kept for backward compat. */
export const CEO_OFFICE_POSITION: Position = { x: 82, y: 72 };

// ---- Legacy desk zone boundaries ----
const DESK_ZONE = { xMin: 10, xMax: 55, yMin: 15, yMax: 85 };
const COLS = 3;
const COL_SPACING = (DESK_ZONE.xMax - DESK_ZONE.xMin) / (COLS - 1); // ~22.5
const ROW_SPACING = 30; // vertical gap between rows

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
 * Generate ad-hoc cluster meeting positions.
 * Given the current positions of 2+ agents, compute the midpoint and
 * spread them in a small circle around it. Returns an array of target
 * positions in the same order as the input array.
 *
 * @param currentPositions - where the agents are right now (used to compute midpoint)
 * @param radius - how far from the midpoint each agent sits (default 6%)
 */
export function generateClusterPositions(
  currentPositions: Position[],
  radius = 6,
): { center: Position; positions: Position[] } {
  const n = currentPositions.length;
  if (n === 0) return { center: { x: 50, y: 50 }, positions: [] };
  if (n === 1) return { center: currentPositions[0], positions: [currentPositions[0]] };

  // Midpoint
  const cx = currentPositions.reduce((s, p) => s + p.x, 0) / n;
  const cy = currentPositions.reduce((s, p) => s + p.y, 0) / n;

  // Clamp so the cluster stays within bounds
  const clampedX = Math.max(radius + 5, Math.min(95 - radius, cx));
  const clampedY = Math.max(radius + 5, Math.min(95 - radius, cy));

  const positions = currentPositions.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      x: clampedX + radius * Math.cos(angle),
      y: clampedY + radius * Math.sin(angle),
    };
  });

  return { center: { x: clampedX, y: clampedY }, positions };
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
