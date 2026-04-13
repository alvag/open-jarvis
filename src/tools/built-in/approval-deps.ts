import type { ApprovalGate } from "../../security/approval-gate.js";

export interface ApprovalDeps {
  approvalGate: ApprovalGate;
  sendApproval: (userId: string, text: string, approvalId: string) => Promise<void>;
  sendResult: (userId: string, text: string) => Promise<void>;
}
