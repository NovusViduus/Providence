package com.providence.citadel.api;

import com.providence.citadel.model.ResponseAction;
import com.providence.citadel.repository.ResponseActionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/actions")
public class ActionController {

    private final ResponseActionRepository actionRepository;

    public ActionController(ResponseActionRepository actionRepository) {
        this.actionRepository = actionRepository;
    }

    @GetMapping
    public Page<ResponseAction> listActions(
            @RequestParam(required = false) String actionType,
            @RequestParam(required = false) String sourceIp,
            @RequestParam(required = false) Boolean success,
            @RequestParam(required = false) Boolean active,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        size = Math.min(size, 200);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));

        if (Boolean.TRUE.equals(active)) return actionRepository.findActive(pageable);
        if (actionType != null) return actionRepository.findByActionType(actionType, pageable);
        if (sourceIp != null) return actionRepository.findBySourceIp(sourceIp, pageable);
        if (success != null) return actionRepository.findBySuccess(success, pageable);

        return actionRepository.findAll(pageable);
    }
}
