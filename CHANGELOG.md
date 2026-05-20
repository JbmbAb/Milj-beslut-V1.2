# Changelog - Miljobeslut.se Portal

## [2.0.0-rc1] - 2026-04-02

### Added

- **New Hexagonal Architecture**: Core logic moved to `src/` with clear layers: Domain, Application, Infrastructure, API, and Platform.
- **Development Governance**: Established `docs/architecture/development-governance.md` for quality gates and AI contributor rules.
- **GPS Tracking (V2)**: Real-time tracking with tamper-evident hash chaining implemented in `src/domain/logistics.ts` and `PrismaLogisticsRepository`.
- **Market Intelligence (V2)**: Live adapter for external price data with static fallbacks.
- **Bank Compliance Scoring (V2)**: Rebuilt scoring engine as a core domain service, computing project ratings based on live requirements and audit logs.
- **BankID Authentication (V2)**: Migrated BankID flows to `src/domain/auth.ts`, `BankIdAdapter`, and Auth Application Use Cases, replacing legacy `bankIdService`.
- **Platform Master**: Composition root for dependency injection and controller management.
- **Unit Tests**: Added comprehensive test suite for all new platform modules in `tests/unit/platform/`.

### Changed

- **API Redirection**: All legacy routes for GPS and Market Intel in `secureApi.express.ts` now point to the new architecture.
- **Type Safety**: Unified `DecisionType` and other core enums into domain models.
- **Kombai Configuration**: Updated `.kombai/stack.json` to enforce "LIVE DATA ONLY" strategy.

### Fixed

- **Type Errors**: Fixed broken imports in `PermitApplicationGeneratorWithEditor.tsx`.
- **Test Stability**: Resolved `DecisionType` undefined errors and Prisma mock mismatches across the test suite.

### Infrastructure

- **Prisma Integration**: Full support for `GpsPosition` and `Project` compliance fields in the new repository layer.
- **Quality Gates**: Zero TypeScript errors, zero ESLint warnings, and >70% test coverage target met for core logic.
