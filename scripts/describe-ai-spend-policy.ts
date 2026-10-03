/**
 * Prints the effective AI spend admission policy (ADR-AI-02 decision 16):
 * which new paid paths are admissible, every limit's status, and the existing
 * interactive AI photo limit. Numbers and flags only; never prints secrets.
 * Limits are application quotas, not external invoice ceilings.
 */

import { describeAiSpendPolicy } from "../src/lib/ai/spend/spend-policy";

console.log(JSON.stringify(describeAiSpendPolicy(process.env), null, 2));
