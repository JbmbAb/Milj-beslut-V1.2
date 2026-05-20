export {
  createAIRecommendation,
  getPendingRecommendationsForReview,
  markAsReviewing,
  submitApprovalReview,
  applyApprovedRecommendation,
  verifySourceIntegrity,
  getApprovalAuditTrail,
  openApprovalGate,
  lockApprovalGate,
  finalizeApprovalGate,
  getApprovalGateStatus,
} from '../../services/decisionFeedbackService';
export type { AIClassificationSuggestion, ApprovalReview } from '../../services/decisionFeedbackService';
