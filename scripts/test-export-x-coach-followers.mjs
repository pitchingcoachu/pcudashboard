#!/usr/bin/env node

import assert from "node:assert/strict";
import { classifyFollower, toCsv } from "./export-x-coach-followers.mjs";

const pitchingCoach = classifyFollower({
  id: "1",
  name: "Alex Coach",
  username: "alexcoach",
  description: "Pitching Coach at Example University Baseball",
  location: "Arizona",
  public_metrics: { followers_count: 200, following_count: 100 },
});
assert.equal(pitchingCoach.confidence, "high");
assert.equal(pitchingCoach.role, "Pitching Coach");
assert.equal(pitchingCoach.school_or_organization_from_bio, "Example University Baseball");

const ambiguous = classifyFollower({
  id: "2",
  name: "Sam",
  username: "sam",
  description: "Baseball development and analytics",
});
assert.equal(ambiguous.confidence, "review");

const lifeCoach = classifyFollower({
  id: "3",
  name: "Taylor",
  username: "taylor",
  description: "Life coach helping former baseball players",
});
assert.equal(lifeCoach.confidence, "not_match");

const csv = toCsv([{ ...pitchingCoach, name: "=DANGEROUS" }]);
assert.match(csv, /"'=DANGEROUS"/);
console.log("X coach follower classifier tests passed");
