export class RegistryIdentityViolationError extends Error {
    constructor(message: string = "REGISTRY_IDENTITY_VIOLATION") {
        super(message);
        this.name = "RegistryIdentityViolationError";
    }
}

export class RegistryProvenanceMissingError extends Error {
    constructor(message: string = "REGISTRY_PROVENANCE_MISSING") {
        super(message);
        this.name = "RegistryProvenanceMissingError";
    }
}

export class RegistryGovernanceViolationError extends Error {
    constructor(message: string = "REGISTRY_GOVERNANCE_VIOLATION") {
        super(message);
        this.name = "RegistryGovernanceViolationError";
    }
}

export class CoreRegistryIsolationViolationError extends Error {
    constructor(message: string = "CORE_REGISTRY_ISOLATION_VIOLATION") {
        super(message);
        this.name = "CoreRegistryIsolationViolationError";
    }
}

export class RegistryNondeterministicError extends Error {
    constructor(message: string = "REGISTRY_NONDETERMINISTIC") {
        super(message);
        this.name = "RegistryNondeterministicError";
    }
}

export class RegistryBindingIntegrityError extends Error {
    constructor(message: string = "REGISTRY_BINDING_INTEGRITY_VIOLATION") {
        super(message);
        this.name = "RegistryBindingIntegrityError";
    }
}

export class RegistryTruthIsolationViolationError extends Error {
    constructor(message: string = "CAPABILITY_REGISTRY_TRUTH_VIOLATION") {
        super(message);
        this.name = "RegistryTruthIsolationViolationError";
    }
}
