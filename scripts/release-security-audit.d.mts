export interface ProductionAuditEvaluation {
  allowed: Array<{ id: string; paths: string[]; reason: string }>
  unexpected: Array<{
    id: string
    moduleName: string
    paths: string[]
    severity: string
    title: string
  }>
}

export declare function evaluateProductionAudit(report: unknown): ProductionAuditEvaluation
export declare function runProductionAudit(): void
