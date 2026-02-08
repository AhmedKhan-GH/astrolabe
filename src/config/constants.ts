/**
 * Application-wide constants
 */

/**
 * Display names for UI elements
 */
export const UI_LABELS = {
  /** The root directory folder name */
  DIRECTORY: 'Directory',
  /** The default database name */
  DATABASE: 'Database',
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  /** Error when attempting to move the root directory */
  CANNOT_MOVE_DIRECTORY: `Cannot move the ${UI_LABELS.DIRECTORY} folder`,
  /** Error when attempting to remove the root directory */
  CANNOT_REMOVE_DIRECTORY: `Cannot remove the ${UI_LABELS.DIRECTORY} folder`,
} as const;
