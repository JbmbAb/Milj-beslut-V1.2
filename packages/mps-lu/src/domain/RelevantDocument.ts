export interface RelevantDocument {
  title: string;
  type: "decision" | "injunction" | "notification" | "inspection";
  metadata: Record<string, any>;
}
