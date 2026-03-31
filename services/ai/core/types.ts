export interface AIRequestOptions {
  subject?: string;
  educationLevel?: string;
  language?: string;
  grade?: string;
  /**
   * Compact digest of the user's saved knowledge records.
   * Injected into the system instruction so the AI can personalise responses
   * based on what the student has already saved and understood.
   */
  userKnowledgeContext?: string;
}

