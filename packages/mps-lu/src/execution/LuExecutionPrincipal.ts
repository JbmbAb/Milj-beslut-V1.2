/** Stable logical LU execution principal. Kept in a dependency-free module so governance
 * projection code does not import the kernel composition root and create an authority-layer cycle. */
export const LU_EXECUTION_PRINCIPAL_ID = "lu.site_assessment.actor" as const;
