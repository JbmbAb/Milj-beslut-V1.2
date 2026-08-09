// scripts/benchmark/legal-golden-set.ts

import { prisma } from '../../server/db/prisma';
import { EvidenceRAGService } from '../../packages/mps-lu/src/services/EvidenceRAGService';

const LEGAL_GOLDEN_SET = [
  {
    question: "Krävs det tillstånd för att bygga en ny stenkrossanläggning?",
    municipality: "Mora",
    expected_chunks: ["chunk-mb-kap9-prövning"], // Logical references for metrics
    expected_authority: "law",
    expected_temporal_scope: "current",
    abstention_expected: false,
    expected_claims: ["Tillstånd krävs för stenkross"],
  },
  {
    question: "Hur ska förorenade schaktmassor hanteras enligt praxis?",
    municipality: "Haninge",
    expected_chunks: ["chunk-mod-praxis-massor"],
    expected_authority: "judgment",
    expected_temporal_scope: "current",
    abstention_expected: false,
    expected_claims: ["MÖD fastslår att anmälan alltid krävs"],
  },
  {
    question: "Vilka bullerkrav gäller för förskolor intill industri?",
    municipality: "Uppsala",
    expected_chunks: ["chunk-nv-guidance-buller"],
    expected_authority: "guidance",
    expected_temporal_scope: "current",
    abstention_expected: false,
    expected_claims: ["Riktvärdet är 50 dBA dagtid"],
  },
  {
    question: "Finns det några dispenser för kemikalieförvaring enligt föråldrade miljöbeslut?",
    municipality: "Mora",
    expected_chunks: ["chunk-decision-2015-kemikalier"],
    expected_authority: "decision",
    expected_temporal_scope: "decayed",
    abstention_expected: true, // Should abstain due to temporal decay
    expected_claims: [],
  },
  {
    question: "Får man överlåta ett undersökningstillstånd utan godkännande?",
    municipality: "Haninge",
    expected_chunks: [],
    expected_authority: "unknown",
    expected_temporal_scope: "current",
    abstention_expected: true, // Missing specific legal evidence in loaded set
    expected_claims: [],
  }
];

export { LEGAL_GOLDEN_SET };
