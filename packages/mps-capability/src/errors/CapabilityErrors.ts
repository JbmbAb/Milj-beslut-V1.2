export class CapabilityIdentityViolationError extends Error {
    constructor(message: string = "CAPABILITY_IDENTITY_VIOLATION") {
        super(message);
        this.name = "CapabilityIdentityViolationError";
    }
}

export class CapabilityBoundaryViolationError extends Error {
    constructor(message: string = "CAPABILITY_BOUNDARY_VIOLATION") {
        super(message);
        this.name = "CapabilityBoundaryViolationError";
    }
}

export class CapabilityNondeterministicError extends Error {
    constructor(message: string = "CAPABILITY_NONDETERMINISTIC") {
        super(message);
        this.name = "CapabilityNondeterministicError";
    }
}

export class ImplementationReferenceInvalidError extends Error {
    constructor(message: string = "IMPLEMENTATION_REFERENCE_INVALID") {
        super(message);
        this.name = "ImplementationReferenceInvalidError";
    }
}

export class CapabilityProvenanceMissingError extends Error {
    constructor(message: string = "CAPABILITY_PROVENANCE_MISSING") {
        super(message);
        this.name = "CapabilityProvenanceMissingError";
    }
}

export class ImplementationReplayMismatchError extends Error {
    constructor(message: string = "IMPLEMENTATION_REPLAY_MISMATCH") {
        super(message);
        this.name = "ImplementationReplayMismatchError";
    }
}

export class CapabilityRegistryTruthViolationError extends Error {
    constructor(message: string = "CAPABILITY_REGISTRY_TRUTH_VIOLATION") {
        super(message);
        this.name = "CapabilityRegistryTruthViolationError";
    }
}
