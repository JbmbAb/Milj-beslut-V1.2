export class WorkflowIdentityViolationError extends Error {
    constructor(message: string = "WORKFLOW_IDENTITY_VIOLATION") {
        super(message);
        this.name = "WorkflowIdentityViolationError";
    }
}

export class WorkflowReferencePolicyViolationError extends Error {
    constructor(message: string = "WORKFLOW_REFERENCE_POLICY_VIOLATION") {
        super(message);
        this.name = "WorkflowReferencePolicyViolationError";
    }
}

export class WorkflowGovernanceViolationError extends Error {
    constructor(message: string = "WORKFLOW_GOVERNANCE_VIOLATION") {
        super(message);
        this.name = "WorkflowGovernanceViolationError";
    }
}

export class WorkflowNondeterministicError extends Error {
    constructor(message: string = "WORKFLOW_NONDETERMINISTIC") {
        super(message);
        this.name = "WorkflowNondeterministicError";
    }
}

export class WorkflowProvenanceMissingError extends Error {
    constructor(message: string = "WORKFLOW_PROVENANCE_MISSING") {
        super(message);
        this.name = "WorkflowProvenanceMissingError";
    }
}

export class WorkflowStateIsolationViolationError extends Error {
    constructor(message: string = "WORKFLOW_STATE_ISOLATION_VIOLATION") {
        super(message);
        this.name = "WorkflowStateIsolationViolationError";
    }
}

export class CapabilityBindingIntegrityError extends Error {
    constructor(message: string = "CAPABILITY_BINDING_INTEGRITY_VIOLATION") {
        super(message);
        this.name = "CapabilityBindingIntegrityError";
    }
}
