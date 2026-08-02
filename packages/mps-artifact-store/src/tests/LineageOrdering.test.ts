/**
 * LineageOrdering.test.ts
 *
 * NORMATIVE
 *
 * Lineage SHALL be lexicographically ordered.
 */

import { describe, expect, it } from "vitest";
import {
  createRepository,
  createLineageGraph
} from "./helpers/index.js";

describe("Lineage ordering", () => {

  it("SHALL return deterministic ordering", async () => {

    const repository = createRepository();

    const graph = createLineageGraph(repository);

    await graph.populateRandomOrder();

    const lineageA = await repository.lineage.lineage(graph.root());

    const lineageB = await repository.lineage.lineage(graph.root());

    expect(lineageA).toEqual(lineageB);

    const ids = lineageA.map(x => x.artifactId);

    expect(ids).toEqual([...ids].sort());

  });

});
