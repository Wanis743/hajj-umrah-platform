/**
 * The modelling engine's public surface.
 *
 * Eleven files in one direction. Each reads only from the ones above it, and the order is the order
 * in which a number is built, so reading them in sequence is reading the model come into existence:
 *
 *   expression   text becomes a tree, or is refused with a position. Every refusal lives here.
 *   evaluate     the tree becomes a number. Total: no throw, no `NaN`, no `Infinity` escapes.
 *   graph        the numbers get an order, and a cycle is refused rather than iterated.
 *   scenario     assumptions inherit down a chain and resolve to one value each.
 *   model        rows are computed period by period. Compile once, run many.
 *   sensitivity  the model is run again with one input moved, or two, or every one in turn.
 *   monte        the model is run ten thousand times with inputs drawn from their ranges.
 *   drivers      what a number is made of, and which change is responsible for a movement.
 *   optimize     the model runs backwards: what would the input have to be, and what is the best.
 *   version      whether two models are the same model, and what changed if not.
 *   certify      whether a model has earned the right to be believed, measured rather than asserted.
 *
 * What is deliberately *not* re-exported: the lexer's `Token` and `TokenKind`, `evaluate`'s
 * `EvalContext`, and `graph`'s `GraphInput`. Those are the seams between the files above, and a
 * consumer that reaches for them is doing something the engine should have been asked to do
 * instead. They remain importable from their own modules for tests, which are the one caller with
 * a legitimate interest in a seam.
 *
 * Two names are changed on the way out, both because the original is too general to sit in an
 * application's import list beside everything else: `Node` would shadow the DOM's, and
 * `MAX_ITERATIONS` says nothing about which iterations it bounds.
 */

/* ------------------------------------------------------------- expression ---- */
export {
  isValidKey,
  parseFormula,
  printFormula,
  referencesOf,
} from './expression';
export type {
  BinaryOp,
  FnName,
  /** The formula AST. Renamed: an unqualified `Node` shadows the DOM's in any consumer. */
  Node as FormulaNode,
  ParseError,
  ParseErrorCode,
  ParseResult,
  Refs,
} from './expression';

/* --------------------------------------------------------------- evaluate ---- */
export { evaluate } from './evaluate';
export type { EvalNote, EvalNoteCode, Evaluation } from './evaluate';

/* ------------------------------------------------------------------ graph ---- */
export { buildGraph } from './graph';
export type {
  CycleIssue,
  GraphIssue,
  GraphResult,
  MissingIssue,
  ModelGraph,
  ShadowedIssue,
} from './graph';

/* --------------------------------------------------------------- scenario ---- */
export { resolveScenario } from './scenario';
export type {
  Assumption,
  AssumptionUnit,
  OutOfRange,
  Resolution,
  Scenario,
  ScenarioIssue,
  ScenarioIssueKind,
  ScenarioResult,
} from './scenario';

/* ------------------------------------------------------------------ model ---- */
export { compileModel, runCompiled, runModel } from './model';
export type {
  CellNote,
  CompiledModel,
  CompileResult,
  FormulaIssue,
  HeldRow,
  ModelFailure,
  ModelResult,
  ModelRow,
  ModelRun,
  ModelSpec,
  SpecIssue,
  SpecIssueKind,
} from './model';

/* ------------------------------------------------------------ sensitivity ---- */
export { measureRun, reachOf, sweepOne, tornado, twoWay } from './sensitivity';
export type {
  Matrix,
  SensitivityIssue,
  SensitivityIssueKind,
  SensitivityResult,
  Sweep,
  SweepPoint,
  Target,
  TargetKind,
  Tornado,
  TornadoBar,
} from './sensitivity';

/* ------------------------------------------------------------------ monte ---- */
export {
  /** Renamed: which iterations `MAX_ITERATIONS` bounds is not guessable from an import list. */
  MAX_ITERATIONS as MAX_SIMULATION_ITERATIONS,
  simulate,
} from './monte';
export type {
  Bin,
  DistributionKind,
  Draw,
  MonteIssue,
  MonteIssueKind,
  MonteResult,
  MonteSettings,
  Percentiles,
  Simulation,
  Threshold,
} from './monte';

/* ---------------------------------------------------------------- drivers ---- */
export { attribute, driverTree } from './drivers';
export type {
  Attribution,
  Contribution,
  DriverIssue,
  DriverIssueKind,
  DriverNode,
  DriverResult,
} from './drivers';

/* --------------------------------------------------------------- optimize ---- */
export { goalSeek, solve } from './optimize';
export type {
  /** Renamed: an unqualified `Constraint` in an application that also has covenants, validation
   *  rules and scheduling constraints says nothing about which kind this is. */
  Constraint as OptimizeConstraint,
  ConstraintOp,
  ConstraintStanding,
  /** Renamed for the same reason as the constraint: too general to sit in an import list. */
  Direction as OptimizeDirection,
  GoalSeek,
  OptimizeIssue,
  OptimizeIssueKind,
  OptimizeResult,
  /** Renamed: `reachOf` above answers "which rows does this assumption reach", and this answers
   *  "what can this target attain". Two unrelated questions must not share a bare noun. */
  Reach as TargetReach,
  /** Renamed: `Root` beside a DOM or React import is the wrong root. */
  Root as GoalRoot,
  SolvedValue,
  Solution,
} from './optimize';

/* ---------------------------------------------------------------- version ---- */
export {
  canonicalFormula,
  canonicalFull,
  canonicalResults,
  compareSpecs,
  hash64,
  versionOf,
  versionOfSpec,
} from './version';
export type { Change, ChangeKind, Comparison, ModelVersion } from './version';

/* ---------------------------------------------------------------- certify ---- */
export { certifies, certify } from './certify';
export type { Certificate, CertifySettings, Check, CheckKind, Grade, Outcome } from './certify';
