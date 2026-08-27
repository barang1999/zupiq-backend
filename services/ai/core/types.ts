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
  /**
   * Retrieved textbook/source snippets for grounding the current answer.
   * This is separate from userKnowledgeContext because it is curriculum/reference
   * material, not the student's personal saved memory.
   */
  referenceContext?: string;
  /**
   * Specific tutoring context about the current step being discussed.
   */
  stepContext?: string;
  /**
   * Free-text instruction the student typed alongside a submitted photo/problem
   * (e.g. "only solve question 2", "explain using the substitution method").
   * Threaded into the solve prompt so the AI follows it for this request only —
   * distinct from stepContext (step-level tutoring) and userKnowledgeContext
   * (persistent saved knowledge).
   */
  userInstruction?: string;
}
