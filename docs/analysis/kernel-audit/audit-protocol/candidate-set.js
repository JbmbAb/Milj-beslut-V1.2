const CANDIDATES = [
  {
    name: 'MISSION',
    definition:
      'The reason a system-level course of action is undertaken: the purpose or objective that justifies why work occurs at all, as distinct from what capability it uses (Capability) or what specific choice it produces (Decision).',
    questions: [
      'Why did a given Decision exist — what higher purpose was it in service of?',
      'Who issued the governing purpose, and were they authorized to issue it?',
      'What scope did that purpose cover, and did the Decision fall within that scope?',
      'Which capability/ability did the purpose require to remain intact or available?',
      'Was the purpose still active/valid at the time the Decision was made?',
      'Could the system itself originate or alter that purpose, or only a human/external authority?',
      'If the purpose later changes or is retired, can every Decision made under it still be explained historically?',
    ],
  },
  {
    name: 'CAPABILITY',
    definition:
      'A durable ability or function the system must be able to keep providing, as distinct from any one particular mechanism, tool, model, or implementation that currently provides it.',
    questions: [
      'What ability or function was at stake when a given Decision or action was taken or considered?',
      'Is that ability governed (versioned, tracked, subject to approval) independent of any one mechanism that provides it today?',
      'If the underlying implementation/mechanism/connector is replaced, does the concept of "what must keep working" survive unchanged?',
      'Can two different technical implementations be recognized as providing the "same" capability?',
      'Does anything in the system today track capability health/availability independent of a specific connector, tool, or model?',
    ],
  },
  {
    name: 'AUTHORITY',
    definition:
      'The scope of what an actor is permitted to do: the bounds within which an action is sanctioned, as distinct from evidence that an action occurred (Evidence) or the specific choice that was made (Decision).',
    questions: [
      'What permitted a given actor to take a given action, as opposed to merely being able to?',
      'What is the boundary of what was permitted, and how would an attempt outside that boundary be recognized and rejected?',
      'Who or what granted the permission, and can that grant be traced and verified after the fact?',
      'Can the permission be revoked, delegated, or scoped to a sub-actor?',
      'Does the system distinguish "permitted" from "physically possible" and from "evidenced as having happened"?',
    ],
  },
  {
    name: 'EVIDENCE',
    definition:
      'Material that supports or documents a claim about a past or present state of affairs, as distinct from an interpretation, conclusion, or decision drawn from it.',
    questions: [
      'What material supports the claim that a given fact/state/event is true?',
      'Can that material be traced back to its origin and verified as unaltered?',
      'Is the material kept structurally distinct from any interpretation, summary, or conclusion drawn from it?',
      'Can a decision be reconstructed or justified purely by tracing to this material?',
      'If the material is later found unreliable, can everything derived from it be identified?',
    ],
  },
  {
    name: 'DECISION',
    definition:
      'A specific choice made among identifiable alternatives at a point in time, as distinct from the reasoning material considered beforehand (Evidence) and the state that results afterward (Outcome).',
    questions: [
      'What specific choice was made among identifiable alternatives?',
      'At what point in time was the choice made, and under what authority?',
      'What material was considered in making the choice?',
      'Can this exact choice be distinguished, structurally, from the reasoning material that led to it and from what happened afterward?',
      'Is there exactly one authoritative, immutable-after-the-fact record of what was chosen?',
    ],
  },
  {
    name: 'OUTCOME',
    definition:
      'The state of affairs that resulted after a decision or action was carried out, as distinct from what was expected or intended beforehand.',
    questions: [
      'What state of affairs existed after a given decision/action was carried out?',
      'Can that resulting state be compared against what was expected/intended beforehand?',
      'Is the resulting state recorded as an observation, structurally distinct from any judgment about whether it was "good"?',
      'Can the system trace which decision produced this outcome?',
      'Does this resulting state need governance/versioning of its own, independent of the decision it followed and the evidence that documents it?',
    ],
  },
]
