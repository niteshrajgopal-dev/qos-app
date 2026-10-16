/** Max durable job claims before QOS ends a stuck Menu Manager run on read or worker step. */
export const MENU_MANAGER_MAX_JOB_ATTEMPTS = 6;

/** After this many reclaim attempts, do not re-run a native model call on uncertain dispatch. */
export const MENU_MANAGER_MAX_UNCERTAIN_NATIVE_CONTINUE_ATTEMPTS = 3;

export const WORKER_STOPPED_MID_REVIEW_CODE = "worker_stopped_mid_review";
export const WORKER_STOPPED_MID_REVIEW_MESSAGE =
  "The AI worker stopped before this review finished. Nothing on the menu was changed.";
