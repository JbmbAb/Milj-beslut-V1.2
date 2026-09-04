/** Action-scoped authority names for Reviewer A's two governed review operations. */
export const DOCUMENT_FACT_REVIEW_ACTION = 'document_fact.review' as const;
export const DOCUMENT_PROPERTY_REVIEW_ACTION = 'document_evidence.property_review' as const;

export const DOCUMENT_FACT_REVIEW_PREDICATE_TYPE = 'mimers-brunn/document-fact-review/v1' as const;
export const DOCUMENT_PROPERTY_REVIEW_PREDICATE_TYPE = 'mimers-brunn/document-property-review/v1' as const;

export interface DocumentReviewSignerPredicate {
  readonly action: typeof DOCUMENT_FACT_REVIEW_ACTION | typeof DOCUMENT_PROPERTY_REVIEW_ACTION;
  readonly signer_key_id: string;
}
