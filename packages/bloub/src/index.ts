/**
 * Surface publique du paquet.
 *
 * Le composant et les CATALOGUES : de quoi afficher l'avatar, le piloter et
 * construire un selecteur de forme, de couleur ou d'humeur. Le reste du moteur
 * reste joignable par un chemin profond (`@repo/bloub/bot/shape.ts`) — c'est
 * pour ecrire une nouvelle silhouette, pas pour l'afficher.
 */

export { BloubBot, type BloubBotHandle, type BloubBotProps } from './BloubBot'
export {
  type Block,
  blockAt,
  clampDuration,
  type Cycle,
  defaultCycle,
  MAX_BLOCK,
  makeBlock,
  MIN_BLOCK,
  minDurationOf,
  offsetOf,
  STEP,
  totalDuration
} from './bot/cycles'
export { BotEngine, type BotFrame, type Look } from './bot/engine'
export {
  type BotExpression,
  DEFAULT_EXPRESSION,
  EXPRESSION_BY_ID,
  EXPRESSIONS,
  type ExpressionId
} from './bot/expressions'
export { DEMI_VIEWBOX, RAYON } from './bot/repere'
export {
  type BotColor,
  type BotShape,
  COLOR_BY_ID,
  COLORS,
  type ColorId,
  DEFAULT_COLOR,
  DEFAULT_SHAPE,
  mixHex,
  SHAPE_BY_ID,
  SHAPES,
  type ShapeId
} from './bot/skins'
export { SEQUENCE, STATE_BY_ID, type StateDef, STATES, type StateId } from './bot/states'
export {
  type Aim,
  type GazeScript,
  HUMEURS,
  lookTarget,
  TOUR_TIME,
  tourLook,
  TURN_TIME
} from './gaze'
