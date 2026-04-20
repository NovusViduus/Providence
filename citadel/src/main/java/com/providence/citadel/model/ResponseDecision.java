package com.providence.citadel.model;

import java.util.List;

public record ResponseDecision(
    String tier,
    Playbook matchedPlaybook,
    List<String> intendedActions
) {}
